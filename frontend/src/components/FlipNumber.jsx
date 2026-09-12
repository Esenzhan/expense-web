import { useLayoutEffect, useRef, useState } from "react";

function zeroDigits(text) {
  return text.replace(/\d/g, "0");
}

// Align the previous digits from the right, so adding/removing a thousands
// group still flips units against units and tens against tens. Punctuation,
// spaces, signs and the currency symbol stay fixed while the number changes.
function previousDigitsByTargetPosition(from, to) {
  const oldDigits = [...from].filter((char) => /\d/.test(char));
  const newDigitCount = [...to].filter((char) => /\d/.test(char)).length;
  const missing = Math.max(0, newDigitCount - oldDigits.length);
  const aligned = [...Array(missing).fill("0"), ...oldDigits].slice(-newDigitCount);
  let index = 0;
  return [...to].map((char) => (/\d/.test(char) ? aligned[index++] : null));
}

export default function FlipNumber({ children, className = "" }) {
  const text = String(children ?? "");
  const latestText = useRef(text);
  const [frame, setFrame] = useState(() => ({
    from: zeroDigits(text),
    to: text,
    revision: 0,
  }));

  useLayoutEffect(() => {
    if (latestText.current === text) return;
    const from = latestText.current;
    latestText.current = text;
    setFrame((current) => ({ from, to: text, revision: current.revision + 1 }));
  }, [text]);

  const previous = previousDigitsByTargetPosition(frame.from, frame.to);
  let digitIndex = 0;

  return (
    <span className={`flip-number ${className}`.trim()} aria-label={frame.to}>
      <span className="flip-number-visual" aria-hidden="true">
        {[...frame.to].map((char, index) => {
          if (!/\d/.test(char)) {
            return (
              <span className="flip-number-static" key={`static-${index}-${char}`}>
                {char}
              </span>
            );
          }

          const oldChar = previous[index] ?? "0";
          const delay = Math.min(digitIndex++, 6) * 12;
          return (
            <span
              className="flip-clock-digit"
              key={`${frame.revision}-${index}-${char}`}
              style={{ "--flip-delay": `${delay}ms` }}
            >
              <span className="flip-clock-final">{char}</span>
              <span className="flip-clock-old-base">{oldChar}</span>
              <span className="flip-clock-old">{oldChar}</span>
              <span className="flip-clock-new">{char}</span>
              <span className="flip-clock-seam" />
            </span>
          );
        })}
      </span>
    </span>
  );
}
