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
    close() {
      if (dgSocket.readyState === WebSocket.OPEN) {
        dgSocket.send(JSON.stringify({ type: "CloseStream" }));
      }
      dgSocket.close();
    },
  };
}
