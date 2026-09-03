import { useRef, useState } from "react";
import { WS_URL, createExpense, scanReceipt, scanReceiptItems } from "../api";
import { enqueueExpense, syncPendingExpenses } from "../offlineQueue";
import { getToken } from "../auth";
import { getCategoryIcon } from "../categoryIcons";
import CategoryGlyph from "./CategoryGlyph";
import { haptic, hapticHeavy, withHaptic } from "../haptics";
import { catIconVars } from "../catIconVars";
import { walletCurrency } from "../wallets";
import { formatMoney } from "../currencies";
import ReceiptCameraSheet from "./ReceiptCameraSheet";

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

// One consistent line-icon set for the bottom dock
function ScanIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7V5.5A1.5 1.5 0 0 1 5.5 4H8" />
      <path d="M16 4h2.5A1.5 1.5 0 0 1 20 5.5V7" />
      <path d="M20 17v1.5a1.5 1.5 0 0 1-1.5 1.5H16" />
      <path d="M8 20H5.5A1.5 1.5 0 0 1 4 18.5V17" />
      <line x1="8" y1="9" x2="16" y2="9" />
      <line x1="8" y1="12" x2="16" y2="12" />
      <line x1="8" y1="15" x2="13" y2="15" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <line x1="12" y1="18" x2="12" y2="21" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor">
      <rect x="7" y="7" width="10" height="10" rx="2.5" />
    </svg>
  );
}

// How long we keep retrying the socket while Render's free tier wakes up
const WS_RETRY_WINDOW_MS = 80000;

// phase: idle -> listening -> processing -> confirming -> idle
export default function VoiceRecorder({ onSaved, onManualAdd, onScanned }) {
  const [phase, setPhase] = useState("idle");
  const [transcript, setTranscript] = useState("");
  const [proposal, setProposal] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");
  // Shows the "waking the server" hint when the socket takes suspiciously
  // long to open (Render free tier cold start)
  const [slowWake, setSlowWake] = useState(false);
  // Receipt scan: its own tiny state machine, independent of `phase` above
  // (that one's owned by the voice websocket flow) — idle whenever it's not
  // actively uploading/parsing a photo.
  const [scanning, setScanning] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);

  const wsRef = useRef(null);
  const sessionRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const fallbackTimerRef = useRef(null);
  const transmitRef = useRef(null);

  // mode comes from the camera sheet's "Одной операцией"/"Раздельно" pill —
  // split hits a different endpoint that returns one proposal per line item
  // instead of a single combined total. onScanned always gets an array (of
  // one, for a plain single-total scan) so the caller has one review flow
  // for either case.
  async function handleCaptured(imageDataUrl, mode) {
    setCameraOpen(false);
    haptic();
    setErrorMessage("");
    setScanning(true);
    try {
      const items = mode === "split" ? await scanReceiptItems(imageDataUrl) : [await scanReceipt(imageDataUrl)];
      onScanned?.(items);
    } catch (err) {
      setErrorMessage(err.message || "Не удалось распознать чек");
    } finally {
      setScanning(false);
    }
  }

  function stopMedia() {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    mediaRecorderRef.current = null;
    streamRef.current = null;
  }

  async function startRecording() {
    haptic();
    setTranscript("");
    setProposal(null);
    setErrorMessage("");
    setSlowWake(false);
    setPhase("listening");

    // One session per recording. Every chunk (and the trailing stop marker)
    // is kept for the whole session: a reconnect gets a fresh Deepgram leg
    // on the server, which needs the container header from chunk #1 — so on
    // every (re)connect we replay the entire buffer, not just the tail.
    const session = { chunks: [], done: false, startedAt: Date.now(), ws: null };
    sessionRef.current = session;

    setTimeout(() => {
      if (!session.done && session.ws?.readyState !== WebSocket.OPEN) setSlowWake(true);
    }, 2000);

    function handleMessage(event) {
      const msg = JSON.parse(event.data);
      if (msg.type === "partial") {
        setTranscript(msg.text);
      } else if (msg.type === "final") {
        setTranscript(msg.text);
        setPhase("processing");
        // The server finalized the utterance on its own (silence endpoint) —
        // release the mic right away, otherwise iOS keeps recording and the
        // orange indicator stays on until the tab dies
        stopMedia();
      } else if (msg.type === "parsed") {
        clearTimeout(fallbackTimerRef.current);
        session.done = true;
        stopMedia();
        setProposal({ ...msg.proposal, raw_text: msg.rawText });
        setPhase("confirming");
        session.ws?.close();
      } else if (msg.type === "error") {
        clearTimeout(fallbackTimerRef.current);
        session.done = true;
        stopMedia();
        setErrorMessage(msg.message);
        setPhase("idle");
        session.ws?.close();
      }
    }

    function connect() {
      const ws = new WebSocket(WS_URL);
      ws.binaryType = "arraybuffer";
      ws.flushed = false;
      session.ws = ws;
      wsRef.current = ws;
      ws.onmessage = handleMessage;

      ws.onopen = () => {
        setSlowWake(false);
        // Auth handshake first — server holds off starting Deepgram until
        // this validates, so it must land before any audio.
        ws.send(JSON.stringify({ type: "auth", token: getToken() }));
        // Give the server's Deepgram leg a beat to finish its own handshake
        // before draining the buffer — the first chunk carries the container
        // header and must not be dropped or reordered
        setTimeout(() => {
          if (session.ws !== ws) return;
          for (const item of session.chunks) {
            if (ws.readyState === WebSocket.OPEN) ws.send(item);
          }
          ws.flushed = true;
        }, 700);
      };

      const retry = () => {
        if (session.done || session.ws !== ws || ws.retried) return;
        ws.retried = true;
        setSlowWake(true);
        if (Date.now() - session.startedAt < WS_RETRY_WINDOW_MS) {
          // Render's free tier sleeps after idle and takes tens of seconds
          // to wake — keep retrying while the recording buffers locally
          setTimeout(() => {
            if (!session.done && session.ws === ws) connect();
          }, 1500);
        } else {
          clearTimeout(fallbackTimerRef.current);
          session.done = true;
          stopMedia();
          setErrorMessage("Сервер не отвечает, попробуй ещё раз");
          setPhase("idle");
        }
      };
      ws.onerror = retry;
      ws.onclose = retry;
    }
    connect();

    function transmit(data) {
      session.chunks.push(data);
      const ws = session.ws;
      if (ws?.flushed && ws.readyState === WebSocket.OPEN) ws.send(data);
    }
    transmitRef.current = transmit;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size === 0) return;
        event.data.arrayBuffer().then(transmit);
      };

      // Small timeslice = near-instant streaming to the server
      recorder.start(250);
    } catch (err) {
      setErrorMessage("Нет доступа к микрофону");
      setPhase("idle");
      session.done = true;
      session.ws?.close();
    }
  }

  function stopRecording() {
    haptic();
    const recorder = mediaRecorderRef.current;
    if (recorder) {
      // The final dataavailable fires before onstop, so by this point the
      // last audio chunk is queued — route the stop marker through the same
      // ordered queue so it can never overtake the audio.
      recorder.onstop = () => {
        transmitRef.current?.(JSON.stringify({ type: "stop" }));
      };
    }
    // Keep the mic streaming ~700ms of trailing silence before stopping:
    // Deepgram endpoints an utterance after ~500ms of in-stream silence, so
    // this finalizes the transcript even if the server-side stop handling
    // is unavailable. The stop marker above then just closes things out.
    // References are captured here so a recording started within the delay
    // window keeps its own recorder/stream untouched.
    const stream = streamRef.current;
    mediaRecorderRef.current = null;
    streamRef.current = null;
    setTimeout(() => {
      if (recorder && recorder.state !== "inactive") recorder.stop();
      stream?.getTracks().forEach((track) => track.stop());
    }, 700);
    setPhase("processing");
    // Socket stays open until the server sends "parsed"/"error" so we don't
    // miss the response while Claude is still parsing. Fallback timeout
    // guards against a real server-side hang; if the socket is still
    // connecting (server waking from sleep), allow the whole retry window.
    const timeoutMs = wsRef.current?.readyState === WebSocket.OPEN ? 15000 : WS_RETRY_WINDOW_MS;
    fallbackTimerRef.current = setTimeout(() => {
      if (sessionRef.current) sessionRef.current.done = true;
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.close();
      }
      setErrorMessage("Не дождались ответа сервера, попробуй ещё раз");
      setPhase("idle");
    }, timeoutMs);
  }

  function cancelRecording() {
    clearTimeout(fallbackTimerRef.current);
    if (sessionRef.current) sessionRef.current.done = true;
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

  function confirmProposal() {
    if (!proposal) return;
    // Buzz at press time: after an await the transient user activation is
    // gone and iOS drops the haptic.
    haptic();
    // Never block on the network here, same as manual add: queue it
    // locally and close the card immediately, syncing in the background.
    // Previously this awaited createExpense directly, so losing signal
    // between finishing the recording and tapping "Сохранить" (elevator,
    // weak spot) silently dropped the expense — the transcript/proposal
    // already had everything needed to queue it like any offline add.
    const { raw_text, ...payload } = proposal;
    const saved = enqueueExpense(payload);
    hapticHeavy();
    onSaved?.(saved);
    syncPendingExpenses(createExpense).then((syncedAny) => {
      if (syncedAny) onSaved?.(saved);
    });
    setProposal(null);
    setTranscript("");
    setPhase("idle");
  }

  const icon = proposal ? getCategoryIcon(proposal.wallet, proposal.category) : null;

  return (
    <>
      {(phase !== "idle" || scanning) && <div className="recorder-backdrop" />}

      <div className="recorder-dock">
        {(phase === "listening" || phase === "processing") && (
          <div className="listen-pill">
            <span>
              {transcript
                ? `«${transcript}»`
                : slowWake && phase === "listening"
                  ? "Слушаю… сервер просыпается, договаривай"
                  : "Я вас слушаю…"}
            </span>
            {phase === "processing" && <span className="spinner" />}
          </div>
        )}

        {scanning && (
          <div className="listen-pill">
            <span>Распознаю чек…</span>
            <span className="spinner" />
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
              <span className="category-icon" style={catIconVars(icon.bg, icon.fg)}>
                <CategoryGlyph emoji={icon.emoji} size={20} />
              </span>
              <div className="confirm-meta">
                <div className="confirm-category">{proposal.category}</div>
                <div className="confirm-wallet">{proposal.wallet}</div>
              </div>
              <div className="confirm-amount">
                −{formatMoney(proposal.amount, walletCurrency(proposal.wallet))}
              </div>
            </div>
            <div className="confirm-actions">
              <button className="btn-secondary" onClick={withHaptic(dismissProposal)}>
                Отмена
              </button>
              <button className="btn-primary" onClick={confirmProposal}>
                Сохранить
              </button>
            </div>
          </div>
        )}

        {phase === "idle" && !scanning && errorMessage && (
          <div className="status-line error">{errorMessage}</div>
        )}

        {phase === "idle" && !scanning && (
          <div className="mic-row">
            <button
              className="side-button"
              onClick={() => {
                haptic();
                setCameraOpen(true);
              }}
              aria-label="Сканировать чек"
            >
              <ScanIcon />
            </button>
            <button className="mic-button" onClick={startRecording} aria-label="Начать запись">
              <MicIcon />
            </button>
            <button
              className="side-button"
              onClick={() => {
                haptic();
                onManualAdd?.();
              }}
              aria-label="Добавить вручную"
            >
              <PlusIcon />
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
              <StopIcon />
            </button>
            <button className="cancel-button" onClick={withHaptic(cancelRecording)} aria-label="Отменить запись">
              ✕
            </button>
          </div>
        )}
      </div>

      {cameraOpen && (
        <ReceiptCameraSheet
          onClose={() => setCameraOpen(false)}
          onCapture={handleCaptured}
          onError={(message) => {
            setCameraOpen(false);
            setErrorMessage(message);
          }}
        />
      )}
    </>
  );
}
