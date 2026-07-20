const WIDTH = 300;
const HEIGHT = 150;
const PAD_LEFT = 34;
const PAD_RIGHT = 6;
const PAD_TOP = 10;
const PAD_BOTTOM = 20;

function niceMax(value) {
  if (value <= 0) return 1000;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const residual = value / magnitude;
  const niceResidual = residual <= 1 ? 1 : residual <= 2 ? 2 : residual <= 5 ? 5 : 10;
  return niceResidual * magnitude;
}

function tenge(value) {
  return `${Math.round(value).toLocaleString("ru-RU")} ₸`;
}

export default function InsightsChart({ series, daysInPeriod, todayIndex, total, previousPeriodTotal }) {
  const chartMax = niceMax(Math.max(total, previousPeriodTotal, 1000));
  const plotWidth = WIDTH - PAD_LEFT - PAD_RIGHT;
  const plotHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;

  const xFor = (day) =>
    daysInPeriod > 1 ? PAD_LEFT + ((day - 1) / (daysInPeriod - 1)) * plotWidth : PAD_LEFT;
  const yFor = (value) => PAD_TOP + plotHeight - (Math.min(value, chartMax) / chartMax) * plotHeight;

  const solidPoints = series.map((p) => `${xFor(p.day)},${yFor(p.cumulative)}`).join(" ");
  const dashedPoints =
    todayIndex < daysInPeriod ? `${xFor(todayIndex)},${yFor(total)} ${xFor(daysInPeriod)},${yFor(total)}` : "";
  const grayPoints = `${xFor(1)},${yFor(previousPeriodTotal)} ${xFor(daysInPeriod)},${yFor(previousPeriodTotal)}`;

  const ticks = [chartMax / 3, (chartMax * 2) / 3, chartMax];
  const dayStep = Math.max(1, Math.round(daysInPeriod / 11 / 2) * 2); // even spacing, ~11 labels max
  const dayLabels = [];
  for (let d = 1; d <= daysInPeriod; d += dayStep) dayLabels.push(d);
  if (dayLabels[dayLabels.length - 1] !== daysInPeriod) dayLabels.push(daysInPeriod);

  return (
    <div className="insights-chart">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="insights-chart-svg">
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD_LEFT}
              x2={WIDTH - PAD_RIGHT}
              y1={yFor(t)}
              y2={yFor(t)}
              className="chart-gridline"
            />
            <text x={0} y={yFor(t) + 3} className="chart-axis-label">
              {Math.round(t).toLocaleString("ru-RU")}
            </text>
          </g>
        ))}

        {dayLabels.map((d) => (
          <text key={d} x={xFor(d)} y={HEIGHT - 4} textAnchor="middle" className="chart-axis-label">
            {d}
          </text>
        ))}

        {grayPoints && <polyline points={grayPoints} className="chart-line-gray" />}
        {solidPoints && <polyline points={solidPoints} className="chart-line-solid" />}
        {dashedPoints && <polyline points={dashedPoints} className="chart-line-dashed" />}

        {series.length > 0 && (
          <circle
            cx={xFor(series[series.length - 1].day)}
            cy={yFor(series[series.length - 1].cumulative)}
            r="4"
            className="chart-dot-orange"
          />
        )}
        <circle cx={xFor(todayIndex)} cy={yFor(previousPeriodTotal)} r="3.5" className="chart-dot-gray" />
      </svg>

      <div className="chart-legend">
        <span className="legend-item">
          <span className="legend-swatch solid" /> {tenge(total)}
        </span>
        <span className="legend-item">
          <span className="legend-swatch gray" /> {tenge(previousPeriodTotal)}
        </span>
        <span className="legend-item">
          <span className="legend-swatch dashed" /> {tenge(total)}
        </span>
      </div>
    </div>
  );
}
