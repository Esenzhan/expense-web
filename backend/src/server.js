import "dotenv/config";
import express from "express";
import cors from "cors";
import http from "http";
import { WebSocketServer } from "ws";

import { initSchema } from "./db.js";
import { expensesRouter } from "./routes/expenses.js";
import { statsRouter } from "./routes/stats.js";
import { categoriesRouter } from "./routes/categories.js";
import { walletsRouter } from "./routes/wallets.js";
import { categoryLimitsRouter } from "./routes/categoryLimits.js";
import { walletBalancesRouter } from "./routes/walletBalances.js";
import { balanceHistoryRouter } from "./routes/balanceHistory.js";
import { walletTransfersRouter } from "./routes/walletTransfers.js";
import { debtsRouter } from "./routes/debts.js";
import { capitalRouter } from "./routes/capital.js";
import { remindersRouter } from "./routes/reminders.js";
import { authRouter } from "./routes/auth.js";
import { authMiddleware, verifyToken } from "./middleware/auth.js";
import { openDeepgramStream } from "./services/deepgramStream.js";
import { parseExpenseFromText } from "./services/parseExpense.js";
import { processSheetsSyncQueue } from "./services/sheetsSyncQueue.js";
import { backfillMissingSheetsRows } from "./services/sheetsBackfill.js"; // TEMPORARY — see that file

const app = express();
app.use(cors({ origin: process.env.FRONTEND_URL || "*" }));
// Default 100kb is fine for everything except the receipt-scan photo
// (base64-encoded, resized client-side but still a couple MB) — raised
// globally rather than per-route since express.json() is mounted once.
app.use(express.json({ limit: "5mb" }));

app.use("/api/auth", authRouter);
app.use("/api/expenses", authMiddleware, expensesRouter);
app.use("/api/stats", authMiddleware, statsRouter);
// Categories/wallets: readable by anyone (the bot needs the list too), but
// creating/deleting is site-only — routes/categories.js and routes/wallets.js
// apply authMiddleware themselves on the mutating handlers.
app.use("/api/categories", categoriesRouter);
app.use("/api/wallets", walletsRouter);
app.use("/api/category-limits", authMiddleware, categoryLimitsRouter);
app.use("/api/wallet-balances", authMiddleware, walletBalancesRouter);
app.use("/api/balance-history", authMiddleware, balanceHistoryRouter);
app.use("/api/wallet-transfers", authMiddleware, walletTransfersRouter);
app.use("/api/debts", authMiddleware, debtsRouter);
app.use("/api/capital", authMiddleware, capitalRouter);
// Not wrapped in authMiddleware at this level — /tick is called by the
// GitHub Actions cron (no user session), the rest apply authMiddleware
// themselves per-route (see routes/reminders.js).
app.use("/api/reminders", remindersRouter);

app.get("/api/health", (req, res) => res.json({ ok: true }));

const server = http.createServer(app);

// --- Live voice streaming over WebSocket ---
// Client connects to wss://.../ws/voice, then:
//  0. sends {type: "auth", token} FIRST — nothing else is processed until
//     this validates (client already buffers its early audio chunks for the
//     DG handshake, so holding them a beat longer for auth is free)
//  1. streams raw MediaRecorder audio chunks (binary frames) as the user speaks
//  2. receives {type: "partial", text} messages continuously — live transcript
//  3. receives {type: "final", text} when an utterance ends (silence detected)
//  4. server then parses the final text with Claude Haiku and sends
//     {type: "parsed", proposal, rawText} back — the client shows a
//     confirm/cancel card and saves it via a plain POST /api/expenses
const wss = new WebSocketServer({ server, path: "/ws/voice" });

wss.on("connection", (clientSocket) => {
  let dgStream = null;

  const startStream = () => {
    dgStream = openDeepgramStream({
      onPartial: (text) => {
        clientSocket.send(JSON.stringify({ type: "partial", text }));
      },
      onFinal: async (text) => {
        clientSocket.send(JSON.stringify({ type: "final", text }));
        if (!text.trim()) return;

        try {
          const parsed = await parseExpenseFromText(text);
          if (parsed.amount == null) {
            clientSocket.send(
              JSON.stringify({ type: "error", message: "Не расслышал сумму, повтори" })
            );
            return;
          }

          clientSocket.send(JSON.stringify({ type: "parsed", proposal: parsed, rawText: text }));
        } catch (err) {
          clientSocket.send(JSON.stringify({ type: "error", message: err.message }));
        }
      },
      onError: (err) => {
        clientSocket.send(JSON.stringify({ type: "error", message: err.message }));
      },
    });
  };

  clientSocket.on("message", async (data, isBinary) => {
    if (!dgStream) {
      if (isBinary) return; // audio arriving before auth — drop it
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "auth") {
          const user = await verifyToken(msg.token);
          if (!user) {
            clientSocket.send(JSON.stringify({ type: "error", message: "Не авторизован" }));
            clientSocket.close();
            return;
          }
          startStream();
        }
      } catch {
        // ignore malformed control frames
      }
      return;
    }

    if (isBinary) {
      dgStream.sendAudioChunk(data);
      return;
    }
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === "stop") {
        // Client finished recording — flush Deepgram so the final
        // transcript arrives now instead of waiting for in-stream silence
        dgStream.finish();
      }
    } catch {
      // ignore malformed control frames
    }
  });

  clientSocket.on("close", () => dgStream && dgStream.close());
});

const PORT = process.env.PORT || 3001;

initSchema()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Server + voice WebSocket listening on port ${PORT}`);
    });
    // Durable retry for the Google Sheets mirror (see sheetsSyncQueue.js) —
    // picks up anything appendExpenseRow/updateExpenseRow/deleteExpenseRow
    // couldn't finish on the first try, including a job whose earlier
    // attempt got cut off by this very process restarting.
    processSheetsSyncQueue().catch((err) => console.error("Sheets sync queue tick failed:", err.message));
    setInterval(() => {
      processSheetsSyncQueue().catch((err) => console.error("Sheets sync queue tick failed:", err.message));
    }, 20_000);
    // TEMPORARY — one-time backfill, see sheetsBackfill.js.
    backfillMissingSheetsRows().catch((err) => console.error("Sheets backfill failed:", err.message));
  })
  .catch((err) => {
    console.error("Failed to init DB schema:", err);
    process.exit(1);
  });
