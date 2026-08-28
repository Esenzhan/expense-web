import { useEffect, useRef, useState } from "react";
import { haptic, hapticHeavy, withHaptic } from "../haptics";
import { resizeImageFile, captureVideoFrame, renderPdfFirstPageToDataUrl } from "../receiptCapture";

function ListIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <line x1="8" y1="6" x2="20" y2="6" />
      <line x1="8" y1="12" x2="20" y2="12" />
      <line x1="8" y1="18" x2="20" y2="18" />
      <circle cx="3.5" cy="6" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="3.5" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="3.5" cy="18" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

function TorchIcon({ on }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 2h6l1 4-1 2v9a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2v-9L8 6l1-4Z" />
      <line x1="8.5" y1="8" x2="15.5" y2="8" />
    </svg>
  );
}

function PdfIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2.5h8l4 4V20a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 20V4A1.5 1.5 0 0 1 5.5 2.5Z" />
      <path d="M14 2.5V7h4" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="16.5" x2="13" y2="16.5" />
    </svg>
  );
}

function GalleryIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <circle cx="8.5" cy="9.5" r="1.6" />
      <path d="m4 17 5-5 4 4 3-3 4 4" />
    </svg>
  );
}

// Full-screen in-app camera for scanning a receipt — replaces handing the
// whole job off to the OS's native file-input capture sheet, so it can
// carry the "Одной операцией"/"Раздельно" mode toggle alongside the shot
// (a receipt with several line items sometimes needs splitting into
// separate expenses) plus torch, PDF, and gallery entry points in one place.
export default function ReceiptCameraSheet({ onClose, onCapture, onError }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const trackRef = useRef(null);
  const pdfInputRef = useRef(null);
  const galleryInputRef = useRef(null);
  const [mode, setMode] = useState("single"); // "single" | "split"
  const [ready, setReady] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [cameraError, setCameraError] = useState("");

  useEffect(() => {
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        const track = stream.getVideoTracks()[0];
        trackRef.current = track;
        // Torch control (MediaTrackConstraints "torch") has patchy browser
        // support — notably absent on iOS Safari/WebKit entirely — so the
        // button only appears when the capability is actually there instead
        // of showing a control that silently does nothing.
        setTorchSupported(!!track?.getCapabilities?.().torch);
        if (videoRef.current) videoRef.current.srcObject = stream;
        setReady(true);
      })
      .catch(() => setCameraError("Нет доступа к камере"));
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }

  function close() {
    stopCamera();
    onClose();
  }

  async function toggleTorch() {
    if (!trackRef.current || !torchSupported) return;
    haptic();
    const next = !torchOn;
    try {
      await trackRef.current.applyConstraints({ advanced: [{ torch: next }] });
      setTorchOn(next);
    } catch {
      // Capability was reported but the constraint got rejected anyway —
      // leave the toggle showing the last state that actually applied.
    }
  }

  function capture() {
    if (!videoRef.current || !ready) return;
    hapticHeavy();
    const dataUrl = captureVideoFrame(videoRef.current);
    stopCamera();
    onCapture(dataUrl, mode);
  }

  async function handlePdfFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    haptic();
    try {
      const dataUrl = await renderPdfFirstPageToDataUrl(file);
      stopCamera();
      onCapture(dataUrl, mode);
    } catch {
      onError?.("Не удалось прочитать PDF");
    }
  }

  async function handleGalleryFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    haptic();
    try {
      const dataUrl = await resizeImageFile(file);
      stopCamera();
      onCapture(dataUrl, mode);
    } catch (err) {
      onError?.(err.message);
    }
  }

  return (
    <div className="camera-sheet">
      <video ref={videoRef} autoPlay playsInline muted className="camera-video" />

      <button className="camera-close" onClick={withHaptic(close)} aria-label="Закрыть">
        ✕
      </button>

      {cameraError && <div className="camera-error">{cameraError}</div>}

      <div className="camera-controls">
        <button
          type="button"
          className="camera-mode-pill"
          onClick={() => {
            haptic();
            setMode((m) => (m === "single" ? "split" : "single"));
          }}
        >
          <span className="mode-dot" />
          {mode === "split" && <ListIcon />}
          <span>{mode === "single" ? "Одной операцией" : "Раздельно"}</span>
        </button>

        <div className="camera-actions-row">
          <button
            type="button"
            className="camera-side-button"
            onClick={withHaptic(toggleTorch)}
            aria-label="Фонарик"
            style={{ visibility: torchSupported ? "visible" : "hidden" }}
          >
            <TorchIcon on={torchOn} />
          </button>

          <button type="button" className="camera-shutter" onClick={capture} disabled={!ready} aria-label="Сделать фото" />

          <div className="camera-side-group">
            <button
              type="button"
              className="camera-side-button"
              onClick={withHaptic(() => pdfInputRef.current?.click())}
              aria-label="Загрузить PDF"
            >
              <PdfIcon />
            </button>
            <button
              type="button"
              className="camera-side-button"
              onClick={withHaptic(() => galleryInputRef.current?.click())}
              aria-label="Выбрать из галереи"
            >
              <GalleryIcon />
            </button>
          </div>
        </div>
      </div>

      <input
        ref={pdfInputRef}
        type="file"
        accept="application/pdf"
        style={{ display: "none" }}
        onChange={handlePdfFile}
      />
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={handleGalleryFile}
      />
    </div>
  );
}
