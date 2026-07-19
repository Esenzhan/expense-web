import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

const INK = "#16161d";
const INK_SOFT = "#7a7a85";
const BORDER = "#e6e6ea";
const MINT = "#159969";

function tenge(value) {
  return `${Number(value).toLocaleString("ru-RU")} ₸`;
}

const tooltipStyle = {
  contentStyle: { background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 10 },
  labelStyle: { color: INK },
};

export function DailyTrendChart({ data }) {
  const chartData = data.map((d) => ({
    day: new Date(d.day).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" }),
    total: Number(d.total),
  }));

  return (
    <div className="chart-card">
      <p className="section-title">Траты по дням</p>
      <ResponsiveContainer width="100%" height={160}>
        <LineChart data={chartData}>
          <CartesianGrid stroke={BORDER} vertical={false} />
          <XAxis dataKey="day" stroke={INK_SOFT} fontSize={11} tickLine={false} />
          <YAxis stroke={INK_SOFT} fontSize={11} tickLine={false} width={40} />
          <Tooltip formatter={(value) => tenge(value)} {...tooltipStyle} />
          <Line type="monotone" dataKey="total" stroke={MINT} strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CategoryBarChart({ data }) {
  const chartData = data.map((d) => ({ category: d.category, total: Number(d.total) }));

  return (
    <div className="chart-card">
      <p className="section-title">По категориям</p>
      <ResponsiveContainer width="100%" height={Math.max(160, chartData.length * 34)}>
        <BarChart data={chartData} layout="vertical" margin={{ left: 10 }}>
          <CartesianGrid stroke={BORDER} horizontal={false} />
          <XAxis type="number" stroke={INK_SOFT} fontSize={11} tickLine={false} />
          <YAxis
            type="category"
            dataKey="category"
            stroke={INK_SOFT}
            fontSize={12}
            width={110}
            tickLine={false}
          />
          <Tooltip formatter={(value) => tenge(value)} {...tooltipStyle} />
          <Bar dataKey="total" fill={INK} radius={[0, 6, 6, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
