import { useEffect, useRef, useState } from "react";

const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

export default function FlipNumber({ children, className = "" }) {
  const text = String(children ?? "");
  const [shown, setShown] = useState(() => text.replace(/\d/g, "0"));
  const raf = useRef(null);
  const fallback = useRef(null);

  useEffect(() => {
    cancelAnimationFrame(raf.current);
    clearTimeout(fallback.current);

    // Give the browser one painted frame at the previous value. Without it,
    // React and CSS can collapse both positions and skip the transition.
    raf.current = requestAnimationFrame(() => setShown(text));
    // Background tabs may pause animation frames; never leave zeroes visible.
    fallback.current = setTimeout(() => setShown(text), 250);

    return () => {
      cancelAnimationFrame(raf.current);
      clearTimeout(fallback.current);
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
