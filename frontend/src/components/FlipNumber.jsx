import { useEffect, useRef, useState } from "react";

const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

export default function FlipNumber({ children, className = "" }) {
  const text = String(children ?? "");
  const [shown, setShown] = useState(() => text.replace(/\d/g, "0"));
  const raf = useRef(null);

  useEffect(() => {
    let cancelled = false;

    function cancelFrame() {
      if (raf.current != null) cancelAnimationFrame(raf.current);
      raf.current = null;
    }

    function startAfterPaint() {
      cancelFrame();
      // The first callback still runs before a paint. A second frame is
      // required to guarantee that the reel's previous position has been
      // presented before we move it. This matters on an online PWA cold
      // launch: iOS can run the first callback while its splash screen is
      // still covering the page, collapsing zero and final positions into
      // the first visible frame.
      raf.current = requestAnimationFrame(() => {
        raf.current = requestAnimationFrame(() => {
          raf.current = null;
          if (!cancelled) setShown(text);
        });
      });
    }

    function onVisible() {
      if (document.visibilityState !== "visible") return;
      document.removeEventListener("visibilitychange", onVisible);
      startAfterPaint();
    }

    // A standalone PWA may mount while its document is still hidden behind
    // the native launch screen. Wait for real visibility instead of using a
    // timer that can finish the number animation before the user sees it.
    if (document.visibilityState === "visible") startAfterPaint();
    else document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      cancelFrame();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [text]);

  // When the formatted length changes, new columns appear immediately instead
  // of shifting the whole amount while its existing digits are still moving.
  const chars = shown.length === text.length ? shown : text;
  const total = chars.length;

  return (
    <span className={`flip-number ${className}`.trim()} aria-label={text} role="text">
      {chars.split("").map((char, index) => {
        if (!/\d/.test(char)) {
          return <span className="flip-number-static" key={index}>{char}</span>;
        }

        return (
          <span className="flip-number-column" key={index} aria-hidden="true">
            <span
              className="flip-number-strip"
              style={{
                transform: `translateY(${-Number(char) * 10}%)`,
                transitionDelay: `${Math.min(total - index - 1, 8) * 45}ms`,
              }}
            >
              {DIGITS.map((digit) => (
                <span className="flip-number-digit" key={digit}>{digit}</span>
              ))}
            </span>
          </span>
        );
      })}
    </span>
  );
}
