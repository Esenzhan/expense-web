import { useEffect, useState } from "react";
import { fetchExpenses, fetchWalletTotals, fetchSummary, fetchCategories, fetchWallets } from "./api";
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

  async function refreshAll(currentPeriod, wallet = selectedWallet) {
    const expenseParams = { limit: 50 };
    if (wallet) expenseParams.wallet = wallet;
    const [exp, wallets, sum] = await Promise.all([
      fetchExpenses(expenseParams),
      fetchWalletTotals(),
      fetchSummary(currentPeriod, wallet),
    ]);
    setExpenses(exp);
    setWalletTotals(wallets);
    setSummary(sum);
    saveCache({ expenses: exp, walletTotals: wallets, summary: sum, wallet });
  }

  useEffect(() => {
    // Fires in the background — the UI above already rendered from cache,
    // so this only silently swaps in fresher numbers once they arrive.
    refreshAll(period, selectedWallet);
  }, [period, selectedWallet]);

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
          wallet={selectedWallet}
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
          defaultWallet={selectedWallet}
          onClose={() => setAddingExpense(false)}
          onSaved={() => {
            setAddingExpense(false);
            refreshAll(period);
          }}
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
