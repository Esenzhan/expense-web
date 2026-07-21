import { useEffect, useRef, useState } from "react";
import { fetchExpenses, fetchExpensesRange, fetchWalletTotals, fetchSummary, fetchCategories, fetchWallets, warmBackend, createExpense } from "./api";
import { listPendingExpenses, syncPendingExpenses, hasPendingExpenses } from "./offlineQueue";
import { computeInsights, periodRange } from "./insights";
import { hydrateCategories } from "./categoryIcons";
import { hydrateWallets, getWalletIcon } from "./wallets";
import { haptic } from "./haptics";
import VoiceRecorder from "./components/VoiceRecorder";
import ExpenseList from "./components/ExpenseList";
import InsightsSheet from "./components/InsightsSheet";
import InsightsButton from "./components/InsightsButton";
import EditExpenseSheet from "./components/EditExpenseSheet";
import SettingsSheet from "./components/SettingsSheet";
import CategoriesSheet from "./components/CategoriesSheet";
import NewCategorySheet from "./components/NewCategorySheet";
import WalletsSheet from "./components/WalletsSheet";
import NewWalletSheet from "./components/NewWalletSheet";

const CACHE_KEY = "traty-cache-v4";

function HeaderIcon({ children }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

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
  // Computed synchronously from whatever was cached last session, so even
  // the very first render already has something to show — no flash of
  // "loading" the instant the sheet is opened.
  const [insights, setInsights] = useState(() => {
    const initialWallet = localStorage.getItem("traty-wallet") || null;
    const pending = listPendingExpenses();
    const pendingForList = initialWallet ? pending.filter((p) => p.wallet === initialWallet) : pending;
    return computeInsights({ period: "month", rows: [...pendingForList, ...(cached.insightsRows || [])] });
  });
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState(null);
  const [addingExpense, setAddingExpense] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [newCategoryOpen, setNewCategoryOpen] = useState(false);
  const [walletsOpen, setWalletsOpen] = useState(false);
  const [newWalletOpen, setNewWalletOpen] = useState(false);
  const [editingWallet, setEditingWallet] = useState(null);
  const [selectedWallet, setSelectedWallet] = useState(
    () => localStorage.getItem("traty-wallet") || null
  );
  const [, setCategoriesVersion] = useState(0);

  // Last known server-truth data (unmerged with the pending-expenses queue),
  // so re-merging after a queue change never double-counts an already
  // merged pending total.
  const rawRef = useRef({
    exp: cached.expenses || [],
    wallets: cached.walletTotals || [],
    sum: cached.summary || { total: 0, categories: [] },
    insightsRows: cached.insightsRows || [],
  });
  const periodRef = useRef(period);
  periodRef.current = period;
  const selectedWalletRef = useRef(selectedWallet);
  selectedWalletRef.current = selectedWallet;

  function selectWallet(name) {
    setSelectedWallet(name);
    if (name) localStorage.setItem("traty-wallet", name);
    else localStorage.removeItem("traty-wallet");
  }

  async function reloadWallets() {
    try {
      const list = await fetchWallets();
      hydrateWallets(list);
      localStorage.setItem("traty-wallets", JSON.stringify(list));
      setCategoriesVersion((v) => v + 1);
    } catch {
      // offline — keep whatever we have
    }
  }

  async function reloadCategories() {
    try {
      const list = await fetchCategories();
      hydrateCategories(list);
      localStorage.setItem("traty-categories", JSON.stringify(list));
      setCategoriesVersion((v) => v + 1); // re-render everything that shows icons
    } catch {
      // offline — keep whatever we have
    }
  }

  useEffect(() => {
    try {
      hydrateCategories(JSON.parse(localStorage.getItem("traty-categories")));
    } catch {
      // no cached categories yet
    }
    try {
      hydrateWallets(JSON.parse(localStorage.getItem("traty-wallets")));
    } catch {
      // no cached wallets yet
    }
    reloadCategories();
    reloadWallets();
  }, []);

  useEffect(() => {
    // Render's free tier sleeps after ~15 min idle and wakes for tens of
    // seconds — start waking it the moment the app opens or comes back to
    // the foreground, so voice input is ready by the time the mic is tapped
    warmBackend();
    const onVisible = () => {
      if (document.visibilityState === "visible") warmBackend();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  // Layers the local pending-expenses queue on top of the last known server
  // data — this is what actually feeds the UI, so an offline manual add
  // shows up in the list, totals, and Insights immediately, without waiting
  // for sync. Also recomputes Insights synchronously (see insights.js) so
  // it's always ready before the sheet is even opened — no network call,
  // no loading spinner, and it works offline since it's pure local
  // arithmetic over whatever rows are cached.
  function mergeAndSet(wallet, currentPeriod) {
    const { exp, wallets, sum, insightsRows } = rawRef.current;
    const pending = listPendingExpenses();
    const pendingForList = wallet ? pending.filter((p) => p.wallet === wallet) : pending;
    const mergedExpenses = [...pendingForList, ...exp];

    const pendingByWallet = new Map();
    for (const p of pending) {
      pendingByWallet.set(p.wallet, (pendingByWallet.get(p.wallet) || 0) + Number(p.amount));
    }
    const mergedWallets = wallets.map((w) => ({
      ...w,
      total: Number(w.total) + (pendingByWallet.get(w.wallet) || 0),
    }));
    for (const [walletName, amount] of pendingByWallet) {
      if (!mergedWallets.some((w) => w.wallet === walletName)) {
        mergedWallets.push({ wallet: walletName, total: amount });
      }
    }

    // Pending expenses are always "just now", so they fall inside every
    // period (month/7/30 all include today) — safe to add unconditionally.
    const pendingTotal = pendingForList.reduce((s, p) => s + Number(p.amount), 0);
    const mergedSummary = { ...sum, total: Number(sum.total) + pendingTotal };

    setExpenses(mergedExpenses);
    setWalletTotals(mergedWallets);
    setSummary(mergedSummary);
    setInsights(computeInsights({ period: currentPeriod, rows: [...pendingForList, ...insightsRows] }));
  }

  async function refreshAll(currentPeriod, wallet = selectedWallet) {
    const expenseParams = { limit: 50 };
    if (wallet) expenseParams.wallet = wallet;
    const { start, end } = periodRange(currentPeriod);
    try {
      const [exp, wallets, sum, insightsRows] = await Promise.all([
        fetchExpenses(expenseParams),
        fetchWalletTotals(),
        fetchSummary(currentPeriod, wallet),
        fetchExpensesRange(start, end, wallet),
      ]);
      rawRef.current = { exp, wallets, sum, insightsRows };
      saveCache({ expenses: exp, walletTotals: wallets, summary: sum, insightsRows, wallet });
    } catch {
      // Offline — nothing fresh from the server, keep the last known data
      // and just re-merge whatever's pending below
    }
    mergeAndSet(wallet, currentPeriod);
  }

  useEffect(() => {
    // Fires in the background — the UI above already rendered from cache,
    // so this only silently swaps in fresher numbers once they arrive.
    refreshAll(period, selectedWallet);
  }, [period, selectedWallet]);

  useEffect(() => {
    // Flush any expenses queued while offline. Triggered on reconnect and on
    // returning to the foreground, but neither is trustworthy alone — iOS
    // Safari (especially in standalone/PWA mode) is known to skip the
    // "online" event, and toggling Wi-Fi/cellular doesn't fire
    // visibilitychange at all since the tab was never backgrounded. A
    // 15s poll while anything is queued is what actually guarantees it
    // eventually goes out.
    function trySyncPending() {
      syncPendingExpenses(createExpense).then((syncedAny) => {
        if (syncedAny) refreshAll(periodRef.current, selectedWalletRef.current);
      });
    }
    const onVisible = () => {
      if (document.visibilityState === "visible") trySyncPending();
    };
    trySyncPending();
    window.addEventListener("online", trySyncPending);
    document.addEventListener("visibilitychange", onVisible);
    const pollId = setInterval(() => {
      if (hasPendingExpenses()) trySyncPending();
    }, 15000);
    return () => {
      window.removeEventListener("online", trySyncPending);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(pollId);
    };
  }, []);

  const walletBalance = selectedWallet
    ? Number(walletTotals.find((w) => w.wallet === selectedWallet)?.total || 0)
    : walletTotals.reduce((sum, w) => sum + Number(w.total), 0);
  const chipIcon = selectedWallet ? getWalletIcon(selectedWallet) : null;

  return (
    <div className={`app ${insightsOpen ? "app-behind" : ""}`}>
      <div className="app-header">
        <button
          className="wallet-chip"
          onClick={() => {
            haptic();
            setWalletsOpen(true);
          }}
        >
          <span
            className="wallet-chip-icon"
            style={chipIcon ? { background: chipIcon.bg, color: chipIcon.fg } : undefined}
          >
            {chipIcon ? chipIcon.emoji : "💳"}
          </span>
          <div>
            <div className="wallet-chip-name">{selectedWallet || "Все счета"}</div>
            <div className="wallet-chip-balance">
              −{walletBalance.toLocaleString("ru-RU")} ₸
            </div>
          </div>
        </button>
        <div className="header-actions">
          <button className="header-icon" aria-label="Поиск">
            <HeaderIcon><circle cx="11" cy="11" r="6" /><path d="m16 16 4 4" /></HeaderIcon>
          </button>
          <button className="header-icon" aria-label="Статистика">
            <HeaderIcon><circle cx="12" cy="12" r="8" /><path d="M12 4v8h8" /></HeaderIcon>
          </button>
          <button className="header-icon" aria-label="Кошельки">
            <HeaderIcon><ellipse cx="12" cy="7" rx="7" ry="2.5" /><path d="M5 7v10c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V7" /><path d="M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5" /></HeaderIcon>
          </button>
          <button
            className="header-icon"
            aria-label="Настройки"
            onClick={() => {
              haptic();
              setSettingsOpen(true);
            }}
          >
            <HeaderIcon><circle cx="12" cy="12" r="3" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1" /></HeaderIcon>
          </button>
        </div>
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
          insights={insights}
          wallet={selectedWallet}
          walletBalance={walletBalance}
          onClose={() => setInsightsOpen(false)}
        />
      )}

      {editingExpense && (
        <EditExpenseSheet
          expense={editingExpense}
          onClose={() => setEditingExpense(null)}
          onCommitted={() => refreshAll(period)}
          onSaved={() => setEditingExpense(null)}
          onDeleted={() => setEditingExpense(null)}
        />
      )}

      {addingExpense && (
        <EditExpenseSheet
          defaultWallet={selectedWallet}
          onClose={() => setAddingExpense(false)}
          onCommitted={() => refreshAll(period)}
          onSaved={() => setAddingExpense(false)}
        />
      )}

      {settingsOpen && (
        <SettingsSheet
          onClose={() => setSettingsOpen(false)}
          onOpenCategories={() => setCategoriesOpen(true)}
        />
      )}

      {categoriesOpen && (
        <CategoriesSheet
          onClose={() => setCategoriesOpen(false)}
          onAdd={() => setNewCategoryOpen(true)}
        />
      )}

      {newCategoryOpen && (
        <NewCategorySheet
          onClose={() => setNewCategoryOpen(false)}
          onCreated={async () => {
            await reloadCategories();
            setNewCategoryOpen(false);
          }}
        />
      )}

      {walletsOpen && (
        <WalletsSheet
          totals={walletTotals}
          selected={selectedWallet}
          onSelect={selectWallet}
          onAdd={() => setNewWalletOpen(true)}
          onEdit={(wallet) => setEditingWallet(wallet)}
          onClose={() => setWalletsOpen(false)}
        />
      )}

      {(newWalletOpen || editingWallet) && (
        <NewWalletSheet
          initial={editingWallet}
          onClose={() => {
            setNewWalletOpen(false);
            setEditingWallet(null);
          }}
          onSaved={async (newName, oldName) => {
            await reloadWallets();
            if (oldName && selectedWallet === oldName) selectWallet(newName);
            setNewWalletOpen(false);
            setEditingWallet(null);
            refreshAll(period);
          }}
        />
      )}
    </div>
  );
}
