import { useEffect, useState } from "react";
import { fetchExpenses, fetchWalletTotals, fetchSummary } from "./api";
import VoiceRecorder from "./components/VoiceRecorder";
import ExpenseList from "./components/ExpenseList";
import InsightsSheet from "./components/InsightsSheet";
import InsightsButton from "./components/InsightsButton";
import EditExpenseSheet from "./components/EditExpenseSheet";

const CACHE_KEY = "traty-cache-v3";

const PERIODS = [
  { value: "month", label: "Этот месяц" },
  { value: "7", label: "7 дней" },
  { value: "30", label: "30 дней" },
];

function loadCache() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY)) || {};
  } catch {
    return {};
  }
}

function saveCache(data) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch {
    // storage full/unavailable — fine, just skip caching
  }
}

export default function App() {
  // Paint instantly from whatever we saw last time (may be empty on first ever run).
  const cached = loadCache();
  const [period, setPeriod] = useState("month");
  const [expenses, setExpenses] = useState(cached.expenses || []);
  const [walletTotals, setWalletTotals] = useState(cached.walletTotals || []);
  const [summary, setSummary] = useState(cached.summary || { total: 0, categories: [] });
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState(null);
  const [addingExpense, setAddingExpense] = useState(false);

  async function refreshAll(currentPeriod) {
    const [exp, wallets, sum] = await Promise.all([
      fetchExpenses({ limit: 50 }),
      fetchWalletTotals(),
      fetchSummary(currentPeriod),
    ]);
    setExpenses(exp);
    setWalletTotals(wallets);
    setSummary(sum);
    saveCache({ expenses: exp, walletTotals: wallets, summary: sum });
  }

  useEffect(() => {
    // Fires in the background — the UI above already rendered from cache,
    // so this only silently swaps in fresher numbers once they arrive.
    refreshAll(period);
  }, [period]);

  const monthLabel = new Date().toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
  const walletBalance = walletTotals.reduce((sum, w) => sum + Number(w.total), 0);

  return (
    <div className={`app ${insightsOpen ? "app-behind" : ""}`}>
      <div className="app-header">
        <div className="wallet-chip">
          <span className="wallet-chip-icon">💳</span>
          <div>
            <div className="wallet-chip-name">Кошелёк</div>
            <div className="wallet-chip-balance">
              −{walletBalance.toLocaleString("ru-RU")} ₸
            </div>
          </div>
        </div>
        <span className="month">{monthLabel}</span>
      </div>

      <div className="summary-card">
        <div className="summary-row">
          <span className="summary-label">Расходы за</span>
          <div className="period-toggle">
            {PERIODS.map((p) => (
              <button
                key={p.value}
                className={`period-pill ${period === p.value ? "active" : ""}`}
                onClick={() => setPeriod(p.value)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <div className="summary-total">−{Number(summary.total).toLocaleString("ru-RU")} ₸</div>
        <InsightsButton onOpen={() => setInsightsOpen(true)} />
      </div>

      <ExpenseList expenses={expenses} onSelect={setEditingExpense} />

      <VoiceRecorder onSaved={() => refreshAll(period)} onManualAdd={() => setAddingExpense(true)} />

      {insightsOpen && (
        <InsightsSheet
          period={period}
          walletBalance={walletBalance}
          onClose={() => setInsightsOpen(false)}
        />
      )}

      {editingExpense && (
        <EditExpenseSheet
          expense={editingExpense}
          onClose={() => setEditingExpense(null)}
          onSaved={() => {
            setEditingExpense(null);
            refreshAll(period);
          }}
          onDeleted={() => {
            setEditingExpense(null);
            refreshAll(period);
          }}
        />
      )}

      {addingExpense && (
        <EditExpenseSheet
          onClose={() => setAddingExpense(false)}
          onSaved={() => {
            setAddingExpense(false);
            refreshAll(period);
          }}
        />
      )}
    </div>
  );
}
