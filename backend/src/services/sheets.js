import { google } from "googleapis";
import { pool } from "../db.js";
import { clientForUser } from "./googleAuth.js";
import { decrypt } from "./crypto.js";
import { sharedWalletNames } from "../wallets.js";
import { almaty } from "./almatyTime.js";

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

// Must NOT use the local getters (getHours/getDate): the server runs in UTC,
// so a 02:00 Almaty expense used to land in the Sheet as 21:00 of the
// previous day. The offset itself lives in services/almatyTime.js.
function formatDateTime(date) {
  const d = almaty(new Date(date));
  const pad = (n) => String(n).padStart(2, "0");
  return {
    date: `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`,
    time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
  };
}

function rowValues(expense, who) {
  const { date, time } = formatDateTime(expense.created_at);
  return [date, time, expense.amount, expense.category, expense.description || "", "сайт", who, String(expense.id)];
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

// No try/catch here on purpose — sheetsSyncQueue.js is what turns a thrown
// error into a scheduled retry. Swallowing it here (the old behavior) is
// exactly what used to lose a row for good the moment a single Google API
// call hiccuped (rate limit, expired token, a server restart mid-request).
async function appendToOne(target, expense, who) {
  if (!target.google_refresh_token) return;
  const spreadsheetId = await ensureUserSheet(target);
  const sheets = sheetsApiFor(decrypt(target.google_refresh_token));
  await getOrCreateWalletTab(sheets, spreadsheetId, expense.wallet);
  // A retry of this same job (another target already succeeded, or a
  // previous attempt got this far and then failed after the API call
  // actually landed) must not re-append and create a duplicate row — check
  // first, same as update/delete already effectively do via findRow.
  const existingRow = await findRow(sheets, spreadsheetId, expense.wallet, expense.id);
  if (existingRow) return;
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${expense.wallet}!A1`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [rowValues(expense, who)] },
  });
}

// Renaming a wallet renames its tab in every account's Sheet. Without it a
// rename silently forks the history: old rows stay on a tab named after the
// old wallet, new ones start a fresh tab under the new name, and editing an
// old expense re-appends it to the new tab (findRow can't see the old one)
// instead of updating it — one expense, two rows, two tabs. Best-effort per
// account, since one dead refresh token mustn't stop the other's tab from
// being renamed; the caller logs whatever comes back.
export async function renameWalletTab(oldWallet, newWallet) {
  const { rows: users } = await pool.query(
    `SELECT * FROM users WHERE google_refresh_token IS NOT NULL AND sheet_id IS NOT NULL`
  );
  const errors = [];
  for (const user of users) {
    try {
      const sheets = sheetsApiFor(decrypt(user.google_refresh_token));
      const { data } = await sheets.spreadsheets.get({ spreadsheetId: user.sheet_id });
      const tab = data.sheets.find((s) => s.properties.title === oldWallet);
      // Nothing logged to this wallet from this account yet, or a tab
      // already sits under the new name (Google rejects duplicate titles) —
      // either way there's nothing safe to rename here.
      if (!tab) continue;
      if (data.sheets.some((s) => s.properties.title === newWallet)) continue;
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: user.sheet_id,
        requestBody: {
          requests: [
            {
              updateSheetProperties: {
                properties: { sheetId: tab.properties.sheetId, title: newWallet },
                fields: "title",
              },
            },
          ],
        },
      });
    } catch (err) {
      errors.push(err);
    }
  }
  if (errors.length) throw errors[0];
}

// Best-effort across targets — one target's failure (e.g. the other
// account's token expired) shouldn't stop this one from mirroring — but
// the caller (sheetsSyncQueue.js) needs to know if ANYTHING failed so it
// can retry, so the first error is rethrown after every target's been tried.
export async function appendExpenseRow(loggingUser, expense) {
  const targets = await resolveTargets(loggingUser, expense.wallet).catch(() => [loggingUser]);
  const who = targets.length > 1 ? loggingUser.name : "";
  const errors = [];
  for (const target of targets) {
    try {
      await appendToOne(target, expense, who);
    } catch (err) {
      errors.push(err);
    }
  }
  if (errors.length) throw errors[0];
}

async function updateOne(target, expense, who) {
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
  const errors = [];
  for (const target of targets) {
    try {
      await updateOne(target, expense, who);
    } catch (err) {
      errors.push(err);
    }
  }
  if (errors.length) throw errors[0];
}

async function deleteOne(target, expense) {
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
}

export async function deleteExpenseRow(loggingUser, expense) {
  const targets = await resolveTargets(loggingUser, expense.wallet).catch(() => [loggingUser]);
  const errors = [];
  for (const target of targets) {
    try {
      await deleteOne(target, expense);
    } catch (err) {
      errors.push(err);
    }
  }
  if (errors.length) throw errors[0];
}
