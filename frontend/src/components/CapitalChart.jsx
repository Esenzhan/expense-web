import { useRef, useState } from "react";
import { almaty } from "../insights";

const WIDTH = 340;
const HEIGHT = 150;
const PAD_LEFT = 4;
const PAD_RIGHT = 4;
const PAD_TOP = 14;
const PAD_BOTTOM = 18;

function tenge(value) {
  return `${Math.round(value).toLocaleString("ru-RU")} ₸`;
}

function shortDate(iso) {
  const shifted = almaty(new Date(iso));
  return shifted.toLocaleDateString("ru-RU", { month: "short", year: "2-digit", timeZone: "UTC" });
}

// Same hand-rolled-SVG approach as InsightsChart, but an area chart over the
// whole history instead of a two-line budget-vs-actual plot — single series,
// so (per the app's existing convention there) no legend, just an
// emphasized, labeled endpoint and a hover crosshair for the rest.
export default function CapitalChart({ points }) {
  const [hoverIndex, setHoverIndex] = useState(null);
  const svgRef = useRef(null);

  if (points.length === 0) return null;

  const plotWidth = WIDTH - PAD_LEFT - PAD_RIGHT;
  const plotHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const values = points.map((p) => p.total);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  const xFor = (i) => PAD_LEFT + (points.length > 1 ? (i / (points.length - 1)) * plotWidth : 0);
  const yFor = (value) => PAD_TOP + plotHeight - ((value - min) / span) * plotHeight;

  const linePoints = points.map((p, i) => [xFor(i), yFor(p.total)]);
  const lineD = linePoints.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  const areaD = `${lineD} L${xFor(points.length - 1).toFixed(1)} ${(PAD_TOP + plotHeight).toFixed(1)} L${PAD_LEFT} ${(PAD_TOP + plotHeight).toFixed(1)} Z`;

  const gridTicks = [min + span * 0.02, min + span * 0.5, max - span * 0.02];
  const dateIdxs = [0, Math.round((points.length - 1) / 2), points.length - 1];
  const lastIndex = points.length - 1;

  function handleMoveAt(clientX) {
    const rect = svgRef.current.getBoundingClientRect();
    const ratio = (clientX - rect.left) / rect.width;
    const idx = Math.max(0, Math.min(lastIndex, Math.round(ratio * lastIndex)));
    setHoverIndex(idx);
  }

  function handleMouseMove(event) {
    handleMoveAt(event.clientX);
  }

  // Touch, not just mouse — this chart lives in a phone PWA first. React's
  // synthetic touch handlers are passive, so this can't preventDefault the
  // page scroll (see ExpenseRow.jsx's swipe gesture for why that would need
  // a manual non-passive listener) — a touch-drag across the chart both
  // scrolls the page and moves the hover point, which is an acceptable
  // trade for a read-only chart, unlike ExpenseRow's actual swipe gesture.
  function handleTouchMove(event) {
    handleMoveAt(event.touches[0].clientX);
  }

  const shown = hoverIndex ?? lastIndex;

  return (
    <div className="capital-chart-card">
      <svg ref={svgRef} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="capital-chart-svg">
        <defs>
          <linearGradient id="capitalAreaFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--ink)" stopOpacity="0.16" />
            <stop offset="100%" stopColor="var(--ink)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {gridTicks.map((t) => (
          <line key={t} className="chart-gridline" x1={PAD_LEFT} x2={WIDTH - PAD_RIGHT} y1={yFor(t)} y2={yFor(t)} />
        ))}
        <path d={areaD} fill="url(#capitalAreaFill)" stroke="none" />
        <path className="capital-chart-line" d={lineD} />
        {dateIdxs.map((i) => (
          <text
            key={i}
            className="chart-axis-label"
            x={xFor(i)}
            y={HEIGHT - 4}
            textAnchor={i === 0 ? "start" : i === lastIndex ? "end" : "middle"}
          >
            {shortDate(points[i].created_at)}
          </text>
        ))}
        <circle className="capital-chart-end-dot" cx={xFor(lastIndex)} cy={yFor(points[lastIndex].total)} r="4" />
        {hoverIndex != null && (
          <>
            <line
              className="capital-chart-hover-line"
              x1={xFor(hoverIndex)}
              x2={xFor(hoverIndex)}
              y1={PAD_TOP}
              y2={PAD_TOP + plotHeight}
            />
            <circle className="capital-chart-hover-dot" cx={xFor(hoverIndex)} cy={yFor(points[hoverIndex].total)} r="4" />
          </>
        )}
        <rect
          x="0"
          y="0"
          width={WIDTH}
          height={HEIGHT}
          fill="transparent"
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoverIndex(null)}
          onTouchStart={handleTouchMove}
          onTouchMove={handleTouchMove}
          onTouchEnd={() => setHoverIndex(null)}
        />
      </svg>
      <div className="capital-chart-tooltip">
        {shortDate(points[shown].created_at)} · {tenge(points[shown].total)}
      </div>
    </div>
  );
}
