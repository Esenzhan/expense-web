import { useEffect, useRef, useState } from "react";
import { fetchExpenses, fetchExpensesRange, fetchWalletTotals, fetchCategories, fetchWallets, fetchMe, warmBackend, createExpense, deleteExpense, deleteCategory } from "./api";
import { getToken, setToken } from "./auth";
import { listPendingExpenses, syncPendingExpenses, hasPendingExpenses, removePendingExpense } from "./offlineQueue";
import { computeInsights, periodRange, formatPeriodLabel } from "./insights";
import { hydrateCategories } from "./categoryIcons";
import { hydrateWallets, getWalletIcon } from "./wallets";
import { haptic } from "./haptics";
import LoginScreen from "./components/LoginScreen";
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
import PeriodPickerSheet from "./components/PeriodPickerSheet";
import SearchSheet from "./components/SearchSheet";

const CACHE_KEY = "traty-cache-v4";

// How long a deleted expense can be brought back before the DELETE is
// actually sent (the reference app's ring takes about this long to drain).
const UNDO_WINDOW_MS = 4000;

function HeaderIcon({ children }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

const PERIODS = [
  { value: "month", label: "Этот месяц" },
  { value: "today", label: "Сегодня" },
];

// Ring that drains counter-clockwise over the undo window, like the
// reference app — shows how long is left to hit "Отменить".
function UndoTimerRing({ durationMs }) {
  const radius = 7;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg className="undo-banner-timer" viewBox="0 0 18 18">
      <circle
        className="undo-banner-timer-track"
        cx="9"
        cy="9"
        r={radius}
        fill="none"
        strokeWidth="2"
      />
      <circle
        className="undo-banner-timer-arc"
        cx="9"
        cy="9"
        r={radius}
        fill="none"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset="0"
        style={{
          animationDuration: `${durationMs}ms`,
          "--ring-circumference": circumference,
        }}
      />
    </svg>
  );
}

// Cache is shared storage on the device but each account's data is private
// now, so it's tagged with the owning account's email — a cache written by
// a different logged-in account (shared device) is treated as empty rather
// than flashed on screen.
function loadCache(email) {
  try {
    const parsed = JSON.parse(localStorage.getItem(CACHE_KEY));
    return parsed && parsed.owner === email ? parsed : {};
  } catch {
    return {};
  }
}

function saveCache(data, email) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ...data, owner: email }));
  } catch {
    // storage full/unavailable — fine, just skip caching
  }
}

// Who was logged in last, saved locally so the app can paint straight from
// cache on the next open without waiting on fetchMe() first — that's the
// one request with no per-wallet fallback, so on a cold Render instance
// (or genuinely offline) it used to leave the whole app blank.
const LAST_USER_KEY = "traty-last-user";

function loadLastUser() {
  try {
    return JSON.parse(localStorage.getItem(LAST_USER_KEY));
  } catch {
    return null;
  }
}

function saveLastUser(me) {
  try {
    localStorage.setItem(LAST_USER_KEY, JSON.stringify(me));
  } catch {
    // storage full/unavailable — fine, just skip caching
  }
}

export default function App() {
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [authError, setAuthError] = useState(null);

  const [period, setPeriod] = useState("month");
  // Last "Выбрать период" selection — kept separately from `period` so the
  // pill still shows the previously picked range even while "Этот месяц"/
  // "Сегодня" is the active one, ready to reselect without reopening the
  // picker.
  const [customRange, setCustomRange] = useState(null);
  const [periodPickerOpen, setPeriodPickerOpen] = useState(false);
  const [expenses, setExpenses] = useState([]);
  const [walletTotals, setWalletTotals] = useState([]);
  const [insights, setInsights] = useState(() => computeInsights({ period: "month", rows: [] }));
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState(null);
  const [addingExpense, setAddingExpense] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [newCategoryWallet, setNewCategoryWallet] = useState(null);
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
    exp: [],
    wallets: [],
    insightsRows: [],
  });
  // Per (period, wallet) snapshots for this session — switching back to an
  // already-visited wallet shows its numbers instantly instead of blocking
  // on the network again, and still quietly refetches behind it to catch
  // anything that changed meanwhile.
  const dataCacheRef = useRef(new Map());
  const periodRef = useRef(period);
  periodRef.current = period;
  const selectedWalletRef = useRef(selectedWallet);
  selectedWalletRef.current = selectedWallet;

  // Deleting is deferred: swiping/tapping delete hides the row and starts a
  // window to undo before the DELETE actually reaches the server — matches
  // the reference app's "Операция удалена — Отменить" banner. { expense,
  // timeoutId } while a deletion is pending, otherwise null.
  const [pendingDelete, setPendingDelete] = useState(null);
  const pendingDeleteRef = useRef(null);
  pendingDeleteRef.current = pendingDelete;
  // Expenses whose DELETE is in flight (undo window already elapsed, or
  // force-committed early by a newer swipe) but not yet confirmed by
  // refreshAll — kept separate from pendingDeleteRef, which only ever
  // tracks the single MOST RECENT swipe. Without this, swiping a second row
  // within another's undo window force-commits the first but then only
  // hides the second from the merged list, so the first flashes back into
  // view for as long as its DELETE round-trip takes (can be tens of
  // seconds on a cold Render instance).
  const committingRef = useRef(new Map()); // id -> { wallet, amount }

  // Paints straight from this account's last cached snapshot — used both
  // by the offline-first bootstrap below and, once fetchMe() actually
  // resolves, for a brand new device that had no cached session yet.
  function applyCachedSession(me) {
    const cached = loadCache(me.email);
    rawRef.current = {
      exp: cached.expenses || [],
      wallets: cached.walletTotals || [],
      insightsRows: cached.insightsRows || [],
    };
    setExpenses(cached.expenses || []);
    setWalletTotals(cached.walletTotals || []);
    const pending = listPendingExpenses();
    const wallet = selectedWalletRef.current;
    const pendingForList = wallet ? pending.filter((p) => p.wallet === wallet) : pending;
    setInsights(
      computeInsights({ period: "month", rows: [...pendingForList, ...(cached.insightsRows || [])] })
    );
  }

  // --- Auth bootstrap ---------------------------------------------------
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get("token");
    const urlError = params.get("authError");
    if (urlToken) setToken(urlToken);
    if (urlError) setAuthError(urlError);
    if (urlToken || urlError) {
      const url = new URL(window.location.href);
      url.searchParams.delete("token");
      url.searchParams.delete("authError");
      window.history.replaceState({}, "", url);
    }

    if (!getToken()) {
      setAuthChecked(true);
      return;
    }

    // Paint from the last known session immediately — no network wait, and
    // it works fully offline. fetchMe() below still runs to confirm/refresh
    // it, but the app is already usable well before that lands (which, on
    // Render's free tier waking from sleep, can take tens of seconds).
    const lastUser = loadLastUser();
    if (lastUser) {
      applyCachedSession(lastUser);
      setUser(lastUser);
      setAuthChecked(true);
    }

    fetchMe()
      .then((me) => {
        saveLastUser(me);
        if (!lastUser) applyCachedSession(me);
        setUser(me);
      })
      .catch(() => {
        // A real 401 already logs out via the "traty:unauthorized" event
        // (apiFetch below) — this catch only fires for network/offline/
        // cold-start failures, which shouldn't kick out an already-showing
        // cached session.
        if (!lastUser) setUser(null);
      })
      .finally(() => setAuthChecked(true));
  }, []);

  useEffect(() => {
    const onUnauthorized = () => setUser(null);
    window.addEventListener("traty:unauthorized", onUnauthorized);
    return () => window.removeEventListener("traty:unauthorized", onUnauthorized);
  }, []);

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
    // Categories/wallets are shared, not per-account — the bot can read
    // them unauthenticated — but still gate on `user` so this doesn't fire
    // (and fail) while the login screen is up.
    if (!user) return;
    reloadCategories();
    reloadWallets();
  }, [user]);

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
    const { exp, wallets, insightsRows } = rawRef.current;
    const pending = listPendingExpenses();
    const pendingForList = wallet ? pending.filter((p) => p.wallet === wallet) : pending;

    // A deletion in its undo window (or already force-committed by a newer
    // swipe, DELETE still in flight) is hidden from the list/totals as if
    // it were already gone — "Отменить" just cancels the timer for the
    // undo-window one, and this filter stops applying to it.
    const excluded = new Map(committingRef.current);
    if (pendingDeleteRef.current) {
      const { expense } = pendingDeleteRef.current;
      excluded.set(expense.id, { wallet: expense.wallet, amount: expense.amount });
    }
    const baseExp = excluded.size ? exp.filter((e) => !excluded.has(e.id)) : exp;
    const baseInsightsRows = excluded.size ? insightsRows.filter((r) => !excluded.has(r.id)) : insightsRows;

    const mergedExpenses = [...pendingForList, ...baseExp];

    const pendingByWallet = new Map();
    for (const p of pending) {
      pendingByWallet.set(p.wallet, (pendingByWallet.get(p.wallet) || 0) + Number(p.amount));
    }
    for (const { wallet: excludedWallet, amount: excludedAmount } of excluded.values()) {
      pendingByWallet.set(excludedWallet, (pendingByWallet.get(excludedWallet) || 0) - Number(excludedAmount));
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

    setExpenses(mergedExpenses);
    setWalletTotals(mergedWallets);
    // The header total ("Расходы за") reads from `insights.total` below —
    // it's computed from the exact same period-bounded rows, so it's always
    // in sync instead of duplicating this arithmetic against a separate
    // backend total. Pending rows keep their real `created_at` (set once,
    // at the moment they were queued) — an item added offline "today" that
    // hasn't synced by tomorrow shouldn't still count toward tomorrow's
    // "Сегодня"/a custom range that excludes it, so it's period-bounded here
    // the same way server rows already are.
    const { start: periodStart, end: periodEnd } = periodRange(currentPeriod);
    const pendingInPeriod = pendingForList.filter((p) => {
      const createdAt = new Date(p.created_at);
      return createdAt >= periodStart && createdAt < periodEnd;
    });
    setInsights(computeInsights({ period: currentPeriod, rows: [...pendingInPeriod, ...baseInsightsRows] }));
  }

  function commitDelete(entry) {
    clearTimeout(entry.timeoutId);
    committingRef.current.set(entry.expense.id, {
      wallet: entry.expense.wallet,
      amount: entry.expense.amount,
    });
    deleteExpense(entry.expense.id)
      .catch(() => {
        // Offline or the request failed — the row already reads as deleted
        // locally; the next successful refresh reconciles either way.
      })
      .finally(() => {
        committingRef.current.delete(entry.expense.id);
        refreshAll(periodRef.current, selectedWalletRef.current);
      });
  }

  // Swipe-delete (ExpenseList) and the edit sheet's delete button both call
  // this. A row that was never synced (still in the offline queue) has
  // nothing to undo on the server, so it's removed immediately instead.
  function requestDeleteExpense(expense) {
    if (expense.pending) {
      removePendingExpense(expense.id);
      refreshAll(periodRef.current, selectedWalletRef.current);
      return;
    }
    if (pendingDeleteRef.current) commitDelete(pendingDeleteRef.current);
    haptic();
    const entry = { expense, timeoutId: null };
    entry.timeoutId = setTimeout(() => {
      if (pendingDeleteRef.current === entry) {
        pendingDeleteRef.current = null;
        setPendingDelete(null);
        commitDelete(entry);
      }
    }, UNDO_WINDOW_MS);
    pendingDeleteRef.current = entry;
    setPendingDelete(entry);
    mergeAndSet(selectedWalletRef.current, periodRef.current);
  }

  function undoDelete() {
    const entry = pendingDeleteRef.current;
    if (!entry) return;
    clearTimeout(entry.timeoutId);
    pendingDeleteRef.current = null;
    setPendingDelete(null);
    haptic();
    mergeAndSet(selectedWalletRef.current, periodRef.current);
  }

  async function refreshAll(currentPeriod, wallet = selectedWallet) {
    // Already-visited (period, wallet) pair this session — paint it
    // immediately so switching wallets doesn't sit blank/stale while the
    // network round-trip (Render free tier can be seconds, or tens of
    // seconds right after a cold start) is still in flight. The fetch
    // below still runs and quietly replaces it once it lands.
    const cacheKey = `${currentPeriod}|${wallet || ""}`;
    const cached = dataCacheRef.current.get(cacheKey);
    if (cached) {
      rawRef.current = cached;
      mergeAndSet(wallet, currentPeriod);
    }

    const expenseParams = { limit: 50 };
    if (wallet) expenseParams.wallet = wallet;
    const { start, end } = periodRange(currentPeriod);
    try {
      const [exp, wallets, insightsRows] = await Promise.all([
        fetchExpenses(expenseParams),
        fetchWalletTotals(),
        fetchExpensesRange(start, end, wallet),
      ]);
      const fresh = { exp, wallets, insightsRows };
      rawRef.current = fresh;
      dataCacheRef.current.set(cacheKey, fresh);
      if (user) saveCache({ expenses: exp, walletTotals: wallets, insightsRows, wallet }, user.email);
    } catch {
      // Offline — nothing fresh from the server, keep the last known data
      // and just re-merge whatever's pending below
    }
    mergeAndSet(wallet, currentPeriod);
  }

  useEffect(() => {
    if (!user) return;
    // Fires in the background — the UI above already rendered from cache,
    // so this only silently swaps in fresher numbers once they arrive.
    refreshAll(period, selectedWallet);
  }, [user, period, selectedWallet]);

  useEffect(() => {
    if (!user) return;
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
    // The Telegram bot writes expenses straight to Postgres — there's no
    // push notification to the site, so pick those up by polling while the
    // tab is in the foreground (and immediately on regaining it).
    function pickUpRemoteChanges() {
      refreshAll(periodRef.current, selectedWalletRef.current);
    }
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        trySyncPending();
        pickUpRemoteChanges();
      }
    };
    trySyncPending();
    window.addEventListener("online", trySyncPending);
    document.addEventListener("visibilitychange", onVisible);
    const pollId = setInterval(() => {
      if (hasPendingExpenses()) trySyncPending();
      if (document.visibilityState === "visible") pickUpRemoteChanges();
    }, 15000);
    return () => {
      window.removeEventListener("online", trySyncPending);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(pollId);
    };
  }, [user]);

  if (!authChecked) {
    return <div className="login-screen" />;
  }

  if (!user) {
    return <LoginScreen error={authError} />;
  }

  const walletBalance = selectedWallet
    ? Number(walletTotals.find((w) => w.wallet === selectedWallet)?.total || 0)
    : walletTotals.reduce((sum, w) => sum + Number(w.total), 0);
  const chipIcon = selectedWallet ? getWalletIcon(selectedWallet) : null;
  const customPeriodValue = customRange ? `custom:${customRange.from}:${customRange.to}` : null;

  return (
    <div className={`app ${insightsOpen ? "app-behind" : ""}`}>
      {pendingDelete && (
        <div className="undo-banner">
          <UndoTimerRing durationMs={UNDO_WINDOW_MS} />
          <span className="undo-banner-text">Операция удалена</span>
          <button className="undo-banner-action" onClick={undoDelete}>
            Отменить
          </button>
        </div>
      )}

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
          <button
            className="header-icon"
            aria-label="Поиск"
            onClick={() => {
              haptic();
              setSearchOpen(true);
            }}
          >
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
            <button
              className={`period-pill ${customRange && period === customPeriodValue ? "active" : ""}`}
              onClick={() => {
                haptic();
                setPeriodPickerOpen(true);
              }}
            >
              {customRange ? formatPeriodLabel(customPeriodValue) : "Выбрать период"}
            </button>
          </div>
        </div>
        <div className="summary-total">−{Number(insights.total).toLocaleString("ru-RU")} ₸</div>
        <InsightsButton onOpen={() => setInsightsOpen(true)} />
      </div>

      <ExpenseList
        expenses={expenses}
        onSelect={setEditingExpense}
        onDeleteRequest={requestDeleteExpense}
        currentUserId={user.id}
      />

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

      {searchOpen && (
        <SearchSheet
          wallet={selectedWallet}
          currentUserId={user.id}
          onClose={() => setSearchOpen(false)}
          onSelect={(expense) => {
            setSearchOpen(false);
            setEditingExpense(expense);
          }}
        />
      )}

      {editingExpense && (
        <EditExpenseSheet
          expense={editingExpense}
          onClose={() => setEditingExpense(null)}
          onCommitted={() => refreshAll(period)}
          onSaved={() => setEditingExpense(null)}
          onDeleted={() => setEditingExpense(null)}
          onDeleteRequested={requestDeleteExpense}
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
          user={user}
          onClose={() => setSettingsOpen(false)}
          onOpenCategories={() => setCategoriesOpen(true)}
        />
      )}

      {categoriesOpen && (
        <CategoriesSheet
          initialWallet={selectedWallet}
          onClose={() => setCategoriesOpen(false)}
          onAdd={(wallet) => setNewCategoryWallet(wallet)}
          onDelete={async (wallet, name) => {
            await deleteCategory(wallet, name);
            await reloadCategories();
          }}
        />
      )}

      {newCategoryWallet && (
        <NewCategorySheet
          wallet={newCategoryWallet}
          onClose={() => setNewCategoryWallet(null)}
          onCreated={async () => {
            await reloadCategories();
            setNewCategoryWallet(null);
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

      {periodPickerOpen && (
        <PeriodPickerSheet
          initialFrom={customRange?.from}
          initialTo={customRange?.to}
          onClose={() => setPeriodPickerOpen(false)}
          onApply={(from, to) => {
            setCustomRange({ from, to });
            setPeriod(`custom:${from}:${to}`);
            setPeriodPickerOpen(false);
          }}
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
          onDeleted={async (deletedName) => {
            await reloadWallets();
            const wasSelected = selectedWallet === deletedName;
            if (wasSelected) selectWallet(null);
            setNewWalletOpen(false);
            setEditingWallet(null);
            refreshAll(period, wasSelected ? null : selectedWallet);
          }}
        />
      )}
    </div>
  );
}
