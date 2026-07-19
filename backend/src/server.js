import "dotenv/config";
import express from "express";
import cors from "cors";
import http from "http";
import { WebSocketServer } from "ws";

import { initSchema } from "./db.js";
import { expensesRouter } from "./routes/expenses.js";
import { statsRouter } from "./routes/stats.js";
import { openDeepgramStream } from "./services/deepgramStream.js";
import { parseExpenseFromText } from "./services/parseExpense.js";

const app = express();
app.use(cors({ origin: process.env.FRONTEND_URL || "*" }));
app.use(express.json());

app.use("/api/expenses", expensesRouter);
app.use("/api/stats", statsRouter);

app.get("/api/health", (req, res) => res.json({ ok: true }));

const server = http.createServer(app);

// --- Live voice streaming over WebSocket ---
// Client connects to wss://.../ws/voice, then:
//  1. streams raw MediaRecorder audio chunks (binary frames) as the user speaks
//  2. receives {type: "partial", text} messages continuously — live transcript
//  3. receives {type: "final", text} when an utterance ends (silence detected)
//  4. server then parses the final text with Claude Haiku and sends
//     {type: "parsed", proposal, rawText} back — the client shows a
//     confirm/cancel card and saves it via a plain POST /api/expenses
const wss = new WebSocketServer({ server, path: "/ws/voice" });

wss.on("connection", (clientSocket) => {
  const dgStream = openDeepgramStream({
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

  clientSocket.on("message", (data, isBinary) => {
    if (isBinary) {
      dgStream.sendAudioChunk(data);
    }
  });

  clientSocket.on("close", () => dgStream.close());
});

const PORT = process.env.PORT || 3001;

initSchema()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Server + voice WebSocket listening on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Failed to init DB schema:", err);
    process.exit(1);
  });
