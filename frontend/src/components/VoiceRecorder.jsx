import { useRef, useState } from "react";
import { WS_URL, createExpense } from "../api";
import { getCategoryIcon } from "../categoryIcons";
import { haptic, hapticHeavy } from "../haptics";

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

// phase: idle -> listening -> processing -> confirming -> idle
export default function VoiceRecorder({ onSaved, onManualAdd }) {
  const [phase, setPhase] = useState("idle");
  const [transcript, setTranscript] = useState("");
  const [proposal, setProposal] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [saving, setSaving] = useState(false);

  const wsRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const fallbackTimerRef = useRef(null);

  function stopMedia() {
    mediaRecorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    mediaRecorderRef.current = null;
    streamRef.current = null;
  }

  async function startRecording() {
    haptic();
    setTranscript("");
    setProposal(null);
    setErrorMessage("");
    setPhase("listening");

    const ws = new WebSocket(WS_URL);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === "partial") {
        setTranscript(msg.text);
      } else if (msg.type === "final") {
        setTranscript(msg.text);
        setPhase("processing");
      } else if (msg.type === "parsed") {
        clearTimeout(fallbackTimerRef.current);
        setProposal({ ...msg.proposal, raw_text: msg.rawText });
        setPhase("confirming");
        ws.close();
      } else if (msg.type === "error") {
        clearTimeout(fallbackTimerRef.current);
        setErrorMessage(msg.message);
        setPhase("idle");
        ws.close();
      }
    };

    try {
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
    } catch (err) {
      setErrorMessage("Нет доступа к микрофону");
      setPhase("idle");
      ws.close();
    }
  }

  function stopRecording() {
    haptic();
    stopMedia();
    setPhase("processing");
    // Socket stays open until the server sends "parsed"/"error" so we don't
    // miss the response while Claude is still parsing. Fallback timeout
    // guards against a real server-side hang.
    fallbackTimerRef.current = setTimeout(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.close();
      }
      setErrorMessage("Не дождались ответа сервера, попробуй ещё раз");
      setPhase("idle");
    }, 15000);
  }

  function cancelRecording() {
    clearTimeout(fallbackTimerRef.current);
    stopMedia();
    wsRef.current?.close();
    setTranscript("");
    setPhase("idle");
  }

  function dismissProposal() {
    setProposal(null);
    setTranscript("");
    setPhase("idle");
  }

  async function confirmProposal() {
    if (!proposal) return;
    setSaving(true);
    setErrorMessage("");
    try {
      const expense = await createExpense(proposal);
      hapticHeavy();
      onSaved?.(expense);
      setProposal(null);
      setTranscript("");
      setPhase("idle");
    } catch (err) {
      setErrorMessage(err.message);
    } finally {
      setSaving(false);
    }
  }

  const icon = proposal ? getCategoryIcon(proposal.category) : null;

  return (
    <>
      {phase !== "idle" && <div className="recorder-backdrop" />}

      <div className="recorder-dock">
        {(phase === "listening" || phase === "processing") && (
          <div className="listen-pill">
            <span>{transcript ? `«${transcript}»` : "Я вас слушаю…"}</span>
            {phase === "processing" && <span className="spinner" />}
          </div>
        )}

        {phase === "confirming" && proposal && (
          <div className="confirm-card">
            <div className="confirm-transcript">«{proposal.raw_text}»</div>
            <div className="confirm-date">
              {new Date().toLocaleDateString("ru-RU", {
                weekday: "short",
                day: "2-digit",
                month: "long",
              })}{" "}
              — Сегодня
            </div>
            <div className="confirm-row">
              <span className="category-icon" style={{ background: icon.bg, color: icon.fg }}>
                {icon.emoji}
              </span>
              <div className="confirm-meta">
                <div className="confirm-category">{proposal.category}</div>
                <div className="confirm-wallet">{proposal.wallet}</div>
              </div>
              <div className="confirm-amount">
                −{Number(proposal.amount).toLocaleString("ru-RU")} ₸
              </div>
            </div>
            <div className="confirm-actions">
              <button className="btn-secondary" onClick={dismissProposal} disabled={saving}>
                Отмена
              </button>
              <button className="btn-primary" onClick={confirmProposal} disabled={saving}>
                {saving ? "Сохраняю…" : "Сохранить"}
              </button>
            </div>
          </div>
        )}

        {phase === "idle" && errorMessage && (
          <div className="status-line error">{errorMessage}</div>
        )}

        {phase === "idle" && (
          <div className="mic-row">
            <button className="side-button" onClick={onManualAdd} aria-label="Сканировать чек">
              📷
            </button>
            <button className="mic-button" onClick={startRecording} aria-label="Начать запись">
              ●
            </button>
            <button className="side-button" onClick={onManualAdd} aria-label="Добавить вручную">
              +
            </button>
          </div>
        )}

        {phase === "listening" && (
          <div className="mic-row">
            <button
              className="mic-button recording"
              onClick={stopRecording}
              aria-label="Остановить запись"
            >
              ■
            </button>
            <button className="cancel-button" onClick={cancelRecording} aria-label="Отменить запись">
              ✕
            </button>
          </div>
        )}
      </div>
    </>
  );
}
