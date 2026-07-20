import WebSocket from "ws";

const DEEPGRAM_URL =
  "wss://api.deepgram.com/v1/listen" +
  "?language=ru" +
  "&model=nova-2" +
  "&punctuate=true" +
  "&interim_results=true" +
  "&endpointing=500"; // ~500ms of silence closes the utterance

/**
 * Opens a connection to Deepgram's realtime API.
 * onPartial(text)  -> called on every interim hypothesis, for live UI updates
 * onFinal(text)    -> called when Deepgram marks an utterance as final
 */
export function openDeepgramStream({ onPartial, onFinal, onError }) {
  const dgSocket = new WebSocket(DEEPGRAM_URL, {
    headers: { Authorization: `Token ${process.env.DEEPGRAM_API_KEY}` },
  });

  // If the handshake itself is rejected (e.g. bad/missing API key), `ws`
  // fires "unexpected-response" instead of "error" — without this handler
  // the failure is completely silent and the client hangs forever.
  dgSocket.on("unexpected-response", (req, res) => {
    let body = "";
    res.on("data", (chunk) => (body += chunk));
    res.on("end", () => {
      onError?.(
        new Error(`Deepgram отклонил подключение (HTTP ${res.statusCode}): ${body || res.statusMessage}`)
      );
    });
  });

  dgSocket.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());
      const alt = msg.channel?.alternatives?.[0];
      if (!alt || !alt.transcript) return;

      if (msg.is_final) {
        onFinal?.(alt.transcript);
      } else {
        onPartial?.(alt.transcript);
      }
    } catch (err) {
      onError?.(err);
    }
  });

  dgSocket.on("error", (err) => onError?.(err));

  return {
    sendAudioChunk(chunk) {
      if (dgSocket.readyState === WebSocket.OPEN) {
        dgSocket.send(chunk);
      }
    },
    // The recording ended: ask Deepgram to flush the final transcript for
    // whatever audio it has. Deliberately does NOT close the socket — the
    // flushed transcript still has to arrive; Deepgram closes after flushing.
    // Without this, an utterance that isn't followed by ≥500ms of in-stream
    // silence never gets an is_final and the client hangs on "Обрабатываю…".
    finish() {
      if (dgSocket.readyState === WebSocket.OPEN) {
        dgSocket.send(JSON.stringify({ type: "CloseStream" }));
      }
    },
    close() {
      if (dgSocket.readyState === WebSocket.OPEN) {
        dgSocket.send(JSON.stringify({ type: "CloseStream" }));
      }
      dgSocket.close();
    },
  };
}
