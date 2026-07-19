import { useRef, useState } from "react";
import { WS_URL } from "../api";

const CANDIDATE_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4", // iOS Safari fallback
];

function pickMimeType() {
  return (
    CANDIDATE_MIME_TYPES.find((type) => window.MediaRecorder?.isTypeSupported?.(type)) ||
    ""
  );
}

export default function VoiceRecorder({ onSaved }) {
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [status, setStatus] = useState("Нажми и говори");

  const wsRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);

  async function startRecording() {
    setTranscript("");
    setStatus("Слушаю…");

    const ws = new WebSocket(WS_URL);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === "partial") {
        setTranscript(msg.text);
      } else if (msg.type === "final") {
        setTranscript(msg.text);
        setStatus("Обрабатываю…");
      } else if (msg.type === "saved") {
        setStatus(`Сохранено: ${msg.expense.amount} ₸ · ${msg.expense.category}`);
        onSaved?.(msg.expense);
      } else if (msg.type === "error") {
        setStatus(msg.message);
      }
    };

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;

    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0 && ws.readyState === WebSocket.OPEN) {
        event.data.arrayBuffer().then((buf) => ws.send(buf));
      }
    };

    // Small timeslice = near-instant streaming to the server
    recorder.start(250);
    setRecording(true);
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    setRecording(false);
    setStatus("Нажми и говори");
    // Give the server a moment to flush the final transcript before closing
    setTimeout(() => wsRef.current?.close(), 1500);
  }

  return (
    <div className="recorder-dock">
      <div className={`transcript-bubble ${transcript ? "" : "empty"}`}>
        {transcript || "Например: «Запиши затраты 2500 кофе»"}
      </div>
      <div className="status-line">{status}</div>
      <button
        className={`mic-button ${recording ? "recording" : ""}`}
        onClick={recording ? stopRecording : startRecording}
        aria-label={recording ? "Остановить запись" : "Начать запись"}
      >
        {recording ? "■" : "●"}
      </button>
    </div>
  );
}
