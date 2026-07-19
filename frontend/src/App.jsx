import { useEffect, useState, Suspense, lazy } from "react";
import {
  fetchExpenses,
  fetchWalletTotals,
  fetchCategoryTotals,
  fetchDailyTotals,
  deleteExpense,
} from "./api";
import VoiceRecorder from "./components/VoiceRecorder";
import WalletSummary from "./components/WalletSummary";
import ExpenseList from "./components/ExpenseList";

// Recharts is the heaviest dependency in the bundle — load it after first
// paint so the mic button and cached list are interactive immediately.
const DailyTrendChart = lazy(() =>
  import("./components/Charts").then((m) => ({ default: m.DailyTrendChart }))
);
const CategoryBarChart = lazy(() =>
  import("./components/Charts").then((m) => ({ default: m.CategoryBarChart }))
);

const CACHE_KEY = "traty-cache-v1";

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
  const [expenses, setExpenses] = useState(cached.expenses || []);
  const [walletTotals, setWalletTotals] = useState(cached.walletTotals || []);
  const [categoryTotals, setCategoryTotals] = useState(cached.categoryTotals || []);
  const [dailyTotals, setDailyTotals] = useState(cached.dailyTotals || []);

  async function refreshAll() {
    const [exp, wallets, categories, daily] = await Promise.all([
      fetchExpenses({ limit: 50 }),
      fetchWalletTotals(),
      fetchCategoryTotals(30),
      fetchDailyTotals(30),
    ]);
    setExpenses(exp);
    setWalletTotals(wallets);
    setCategoryTotals(categories);
    setDailyTotals(daily);
    saveCache({ expenses: exp, walletTotals: wallets, categoryTotals: categories, dailyTotals: daily });
  }

  useEffect(() => {
    // Fires in the background — the UI above already rendered from cache,
    // so this only silently swaps in fresher numbers once they arrive.
    refreshAll();
  }, []);

  async function handleDelete(id) {
    await deleteExpense(id);
    refreshAll();
  }

  const monthLabel = new Date().toLocaleDateString("ru-RU", { month: "long", year: "numeric" });

  return (
    <div className="app">
      <div className="app-header">
        <h1>Траты</h1>
        <span className="month">{monthLabel}</span>
      </div>

      <WalletSummary totals={walletTotals} />
      <Suspense fallback={null}>
        <DailyTrendChart data={dailyTotals} />
        <CategoryBarChart data={categoryTotals} />
      </Suspense>
      <ExpenseList expenses={expenses} onDelete={handleDelete} />

      <VoiceRecorder onSaved={refreshAll} />
    </div>
  );
}
