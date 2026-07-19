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

const GOLD = "#c9a227";
const RUST = "#b5542d";
const STONE = "#8a8578";

function tenge(value) {
  return `${Number(value).toLocaleString("ru-RU")} ₸`;
}

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
          <CartesianGrid stroke="#3a362f" vertical={false} />
          <XAxis dataKey="day" stroke={STONE} fontSize={11} tickLine={false} />
          <YAxis stroke={STONE} fontSize={11} tickLine={false} width={40} />
          <Tooltip
            formatter={(value) => tenge(value)}
            contentStyle={{ background: "#1b1a17", border: "1px solid #3a362f" }}
            labelStyle={{ color: "#f6f1e7" }}
          />
          <Line type="monotone" dataKey="total" stroke={GOLD} strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CategoryBarChart({ data }) {
  const chartData = data.map((d) => ({ category: d.category, total: Number(d.total) }));

  return (
    <div className="chart-card">
      <p className="section-title">По категориям (30 дней)</p>
      <ResponsiveContainer width="100%" height={Math.max(160, chartData.length * 34)}>
        <BarChart data={chartData} layout="vertical" margin={{ left: 10 }}>
          <CartesianGrid stroke="#3a362f" horizontal={false} />
          <XAxis type="number" stroke={STONE} fontSize={11} tickLine={false} />
          <YAxis
            type="category"
            dataKey="category"
            stroke={STONE}
            fontSize={12}
            width={90}
            tickLine={false}
          />
          <Tooltip
            formatter={(value) => tenge(value)}
            contentStyle={{ background: "#1b1a17", border: "1px solid #3a362f" }}
            labelStyle={{ color: "#f6f1e7" }}
          />
          <Bar dataKey="total" fill={RUST} radius={[0, 3, 3, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
