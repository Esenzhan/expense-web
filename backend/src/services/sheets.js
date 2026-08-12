import { google } from "googleapis";
import { pool } from "../db.js";
import { clientForUser } from "./googleAuth.js";
import { decrypt } from "./crypto.js";
import { sharedWalletNames } from "../wallets.js";

// Row layout is intentionally identical to what the Telegram bot used to
// write directly (see expense-bot/bot.py get_wallet_sheet/save_expense) so
// its /budget and /renovation commands — which read these sheets straight
// with gspread's get_all_records() — keep working unchanged. "ID" is new:
// it's appended as a trailing column so we can find/update/delete a row
// later; the bot never reads that far right, so it's invisible to it.
const HEADER = ["Дата", "Время", "Сумма", "Категория", "Описание", "Источник", "Кто", "ID"];

function sheetsApiFor(refreshToken) {
  const auth = clientForUser(refreshToken);
  return google.sheets({ version: "v4", auth });
}

export async function ensureUserSheet(user) {
  if (user.sheet_id) return user.sheet_id;

  const refreshToken = decrypt(user.google_refresh_token);
  const sheets = sheetsApiFor(refreshToken);
  const { data } = await sheets.spreadsheets.create({
    requestBody: { properties: { title: `Траты — ${user.name}` } },
  });

  await pool.query(`UPDATE users SET sheet_id = $1 WHERE id = $2`, [
    data.spreadsheetId,
    user.id,
  ]);
  return data.spreadsheetId;
}

// Finds the wallet's tab, creating it (with the header row) if this is the
// first expense ever written to that wallet for this user.
async function getOrCreateWalletTab(sheets, spreadsheetId, wallet) {
  const { data } = await sheets.spreadsheets.get({ spreadsheetId });
  const existing = data.sheets.find((s) => s.properties.title === wallet);
  if (existing) return existing.properties.sheetId;

  const { data: batchResult } = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ addSheet: { properties: { title: wallet } } }] },
  });
  const sheetId = batchResult.replies[0].addSheet.properties.sheetId;
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${wallet}!A1`,
    valueInputOption: "RAW",
    requestBody: { values: [HEADER] },
  });
  return sheetId;
}

// Shared wallets (Семья/Бизнес/Ремонт by default) mirror into BOTH
// accounts' personal Sheets — that's the whole household's shared budget,
// so either person opening their own Sheet sees the full picture. Private
// wallets (Личные) only ever go to the logging account's own Sheet.
async function resolveTargets(loggingUser, wallet) {
  const shared = await sharedWalletNames();
  if (!shared.includes(wallet)) return [loggingUser];
  const { rows } = await pool.query(`SELECT * FROM users WHERE google_refresh_token IS NOT NULL`);
  return rows.length ? rows : [loggingUser];
}

function formatDateTime(date) {
  const d = new Date(date);
  const pad = (n) => String(n).padStart(2, "0");
  return {
    date: `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

function rowValues(expense, who) {
  const { date, time } = formatDateTime(expense.created_at);
  return [date, time, expense.amount, expense.category, expense.description || "", "сайт", who, String(expense.id)];
}

async function appendToOne(target, expense, who) {
  try {
    if (!target.google_refresh_token) return;
    const spreadsheetId = await ensureUserSheet(target);
    const sheets = sheetsApiFor(decrypt(target.google_refresh_token));
    await getOrCreateWalletTab(sheets, spreadsheetId, expense.wallet);
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${expense.wallet}!A1`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [rowValues(expense, who)] },
    });
  } catch (err) {
    console.error("Sheets mirror (append) failed:", err.message);
  }
}

// Best-effort — callers should not let a Sheets failure block the Postgres
// write, which stays authoritative for the site itself.
export async function appendExpenseRow(loggingUser, expense) {
  const targets = await resolveTargets(loggingUser, expense.wallet).catch(() => [loggingUser]);
  const who = targets.length > 1 ? loggingUser.name : "";
  for (const target of targets) {
    await appendToOne(target, expense, who);
  }
}

async function findRow(sheets, spreadsheetId, wallet, expenseId) {
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${wallet}!H2:H`,
  });
  const ids = data.values || [];
  const idx = ids.findIndex((row) => row[0] === String(expenseId));
  return idx === -1 ? null : idx + 2; // header is row 1
}

async function updateOne(target, expense, who) {
  try {
    if (!target.google_refresh_token) return;
    const spreadsheetId = await ensureUserSheet(target);
    const sheets = sheetsApiFor(decrypt(target.google_refresh_token));
    await getOrCreateWalletTab(sheets, spreadsheetId, expense.wallet);
    const row = await findRow(sheets, spreadsheetId, expense.wallet, expense.id);
    if (!row) {
      await appendToOne(target, expense, who);
      return;
    }
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${expense.wallet}!A${row}:H${row}`,
      valueInputOption: "RAW",
      requestBody: { values: [rowValues(expense, who)] },
    });
  } catch (err) {
    console.error("Sheets mirror (update) failed:", err.message);
  }
}

export async function updateExpenseRow(loggingUser, expense, previousWallet) {
  // Wallet changed — the set of target sheets may differ (private↔shared,
  // or a different shared wallet), so just delete the old row everywhere
  // it lived and append fresh everywhere the new wallet lives.
  if (previousWallet !== expense.wallet) {
    await deleteExpenseRow(loggingUser, { ...expense, wallet: previousWallet });
    await appendExpenseRow(loggingUser, expense);
    return;
  }

  const targets = await resolveTargets(loggingUser, expense.wallet).catch(() => [loggingUser]);
  const who = targets.length > 1 ? loggingUser.name : "";
  for (const target of targets) {
    await updateOne(target, expense, who);
  }
}

async function deleteOne(target, expense) {
  try {
    if (!target.google_refresh_token) return;
    const spreadsheetId = await ensureUserSheet(target);
    const sheets = sheetsApiFor(decrypt(target.google_refresh_token));

    const { data } = await sheets.spreadsheets.get({ spreadsheetId });
    const tab = data.sheets.find((s) => s.properties.title === expense.wallet);
    if (!tab) return;
    const row = await findRow(sheets, spreadsheetId, expense.wallet, expense.id);
    if (!row) return;

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId: tab.properties.sheetId,
                dimension: "ROWS",
                startIndex: row - 1,
                endIndex: row,
              },
            },
          },
        ],
      },
    });
  } catch (err) {
    console.error("Sheets mirror (delete) failed:", err.message);
  }
}

export async function deleteExpenseRow(loggingUser, expense) {
  const targets = await resolveTargets(loggingUser, expense.wallet).catch(() => [loggingUser]);
  for (const target of targets) {
    await deleteOne(target, expense);
  }
}
