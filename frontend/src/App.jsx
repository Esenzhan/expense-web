import { useEffect, useRef, useState } from "react";
import { fetchExpenses, fetchExpensesRange, fetchWalletTotals, fetchWalletBalances, setWalletBalance, fetchCategories, fetchWallets, fetchMe, warmBackend, createExpense, deleteExpense, deleteCategory, saveThemeSetting } from "./api";
import { loadLocalTheme, setLocalTheme } from "./theme";
import { getToken, setToken } from "./auth";
import { listPendingExpenses, syncPendingExpenses, hasPendingExpenses, removePendingExpense, clearConfirmedSynced } from "./offlineQueue";
import { computeInsights, periodRange, formatPeriodLabel } from "./insights";
import { hydrateCategories } from "./categoryIcons";
import { hydrateWallets, getWalletIcon } from "./wallets";
import { haptic } from "./haptics";
import { catIconVars } from "./catIconVars";
import CategoryGlyph from "./components/CategoryGlyph";
import LoginScreen from "./components/LoginScreen";
import VoiceRecorder from "./components/VoiceRecorder";
import ExpenseList from "./components/ExpenseList";
import InsightsSheet from "./components/InsightsSheet";
import InsightsButton from "./components/InsightsButton";
import EditExpenseSheet from "./components/EditExpenseSheet";
import ScanReviewSheet from "./components/ScanReviewSheet";
import SettingsSheet from "./components/SettingsSheet";
import RemindersSheet from "./components/RemindersSheet";
import ThemeSheet from "./components/ThemeSheet";
import CategoriesSheet from "./components/CategoriesSheet";
import NewCategorySheet from "./components/NewCategorySheet";
import WalletsSheet from "./components/WalletsSheet";
import NewWalletSheet from "./components/NewWalletSheet";
import WalletTransferSheet from "./components/WalletTransferSheet";
import BalanceHistorySheet from "./components/BalanceHistorySheet";
import DebtsSheet from "./components/DebtsSheet";
import NewDebtSheet from "./components/NewDebtSheet";
import DebtDetailSheet from "./components/DebtDetailSheet";
import CapitalSheet from "./components/CapitalSheet";
import NewCapitalSnapshotSheet from "./components/NewCapitalSnapshotSheet";
import CapitalDetailSheet from "./components/CapitalDetailSheet";
import PeriodPickerSheet from "./components/PeriodPickerSheet";
import SearchSheet from "./components/SearchSheet";
import AccountBalanceRow from "./components/AccountBalanceRow";
import { useSwipeDismissUp } from "./sheetGestures";
import { loadCached, saveCached } from "./offlineCache";

const CACHE_KEY = "traty-cache-v4";
// Wallet balances aren't scoped to a (period, wallet) pair like the cache
// above — every wallet's current balance is the same regardless of which
// tab is open — so they get their own flat, account-scoped cache instead of
// living inside CACHE_KEY's per-selection blobs.
const BALANCES_CACHE_KEY = "traty-wallet-balances-cache-v1";

// How long a deleted expense can be brought back before the DELETE is
// actually sent (the reference app's ring takes about this long to drain).
const UNDO_WINDOW_MS = 4000;

// How long a row's exit animation runs — must match the transition duration
// on .expense-row-wrap.exiting in styles.css.
const ROW_EXIT_MS = 240;

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
//
// Keyed by the same `${period}|${wallet}` string as dataCacheRef (the
// in-session Map in App) — this is that Map's persisted mirror, so a wallet
// visited in an earlier session paints instantly too, not just the one
// most recently viewed. Previously this held a single flat snapshot (the
// last-viewed wallet only), so switching to any OTHER wallet had nothing to
// paint from and had to block on a real network round trip — offline, that
// fetch fails in milliseconds and falls back to (wrong, stale) data
// instantly, which is what made switching wallets look faster offline than
// on, a working connection, where it actually waits out the request.
// Custom date-range periods are deliberately never persisted here — the
// key is the literal "custom:from:to" string, so exploring ranges would
// otherwise grow this without bound over weeks of use.
function loadCache(email) {
  try {
    const parsed = JSON.parse(localStorage.getItem(CACHE_KEY));
    return parsed && parsed.owner === email && parsed.entries ? parsed.entries : {};
  } catch {
    return {};
  }
}

function saveCache(cacheKey, data, email) {
  if (cacheKey.startsWith("custom:")) return;
  try {
    const entries = loadCache(email);
    entries[cacheKey] = data;
    localStorage.setItem(CACHE_KEY, JSON.stringify({ owner: email, entries }));
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
  const [walletBalances, setWalletBalances] = useState([]);
  // Per-wallet net delta between what the last server fetch said and what's
  // showing right now (offline-queued expenses not yet synced = positive,
  // an in-flight/undo-window delete = negative) — same numbers `mergeAndSet`
  // already applies to `walletTotals`, kept here too so "Баланс" updates in
  // the same instant as the rest of the card instead of lagging behind
  // until the undo window's real DELETE lands and refreshAll() re-fetches.
  const [pendingWalletDeltas, setPendingWalletDeltas] = useState(new Map());
  // "Только мои" — hides the other account's rows on a shared wallet
  // (Семья/Бизнес/Ремонт). Whether to even show the toggle is derived from
  // the loaded data itself (any row with a foreign user_id) rather than a
  // wallet.shared flag, so it needs no extra fetch/registry.
  const [onlyMine, setOnlyMine] = useState(false);
  const onlyMineRef = useRef(onlyMine);
  onlyMineRef.current = onlyMine;
  const [hasOtherAuthor, setHasOtherAuthor] = useState(false);
  const [insights, setInsights] = useState(() => computeInsights({ period: "month", rows: [] }));
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState(null);
  const [addingExpense, setAddingExpense] = useState(false);
  // Receipt scan result — an array of one or more detected expenses (one
  // for a plain scan, several for "Раздельно"), reviewed together in
  // ScanReviewSheet rather than opening EditExpenseSheet.
  const [scanItems, setScanItems] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [remindersOpen, setRemindersOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const [balanceHistoryOpen, setBalanceHistoryOpen] = useState(false);
  const [theme, setTheme] = useState(loadLocalTheme);
  const themeSyncedRef = useRef(false);
  const [newCategoryWallet, setNewCategoryWallet] = useState(null);
  const [editingCategory, setEditingCategory] = useState(null);
  const [walletsOpen, setWalletsOpen] = useState(false);
  const [newWalletOpen, setNewWalletOpen] = useState(false);
  const [editingWallet, setEditingWallet] = useState(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [debtsOpen, setDebtsOpen] = useState(false);
  const [newDebtOpen, setNewDebtOpen] = useState(false);
  const [selectedDebt, setSelectedDebt] = useState(null);
  const [debtsRefreshKey, setDebtsRefreshKey] = useState(0);
  const [capitalOpen, setCapitalOpen] = useState(false);
  const [newCapitalOpen, setNewCapitalOpen] = useState(false);
  const [newCapitalPrevId, setNewCapitalPrevId] = useState(null);
  const [selectedCapitalSnapshot, setSelectedCapitalSnapshot] = useState(null);
  const [capitalRefreshKey, setCapitalRefreshKey] = useState(0);
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
  // Guards against out-of-order refreshAll responses for the SAME (period,
  // wallet) key — adding several expenses back to back fires one refreshAll
  // per save, all uncoordinated, and a slower/older one (Render's cold
  // start can take tens of seconds; the browser's own per-origin connection
  // cap queues the rest behind it) can easily land after a faster/newer one
  // already did. Without this, that late arrival's pre-delete/pre-add
  // snapshot overwrites rawRef with stale data — and if a delete's own undo
  // window has already lifted its exclusion by then, the row it removed
  // gets silently resurrected, stuck showing whatever the swipe left behind
  // since nothing since has re-rendered it. Only the most-recently-ISSUED
  // request for a key is allowed to write rawRef/clear synced shadows.
  const requestSeqRef = useRef(new Map());
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
  // Ids currently playing their row-out exit animation (see ROW_EXIT_MS and
  // .expense-row-wrap.exiting in styles.css) — mergeAndSet keeps a row in
  // the rendered list for this long past the moment it's excluded from
  // totals, so tapping delete plays a visible collapse instead of the row
  // just vanishing the instant the numbers update.
  const exitingRef = useRef(new Set());
  // State, not a plain ref: the banner mounts/unmounts inside this
  // never-unmounting component, so the ref callback needs to trigger a
  // re-render for useSwipeDismissUp's effect to see it — see that hook's
  // comment for why.
  const [undoBannerEl, setUndoBannerEl] = useState(null);
  useSwipeDismissUp(undoBannerEl, dismissUndoBanner);

  // Paints straight from this account's last cached snapshot — used both
  // by the offline-first bootstrap below and, once fetchMe() actually
  // resolves, for a brand new device that had no cached session yet.
  // Rehydrates dataCacheRef with EVERY persisted (period, wallet) entry, not
  // just the current one, so switching to any wallet visited in an earlier
  // session paints instantly too — see loadCache's comment.
  function applyCachedSession(me) {
    const entries = loadCache(me.email);
    dataCacheRef.current = new Map(Object.entries(entries));
    const cacheKey = `${periodRef.current}|${selectedWalletRef.current || ""}`;
    const cached = entries[cacheKey] || {};
    rawRef.current = {
      exp: cached.exp || [],
      wallets: cached.wallets || [],
      insightsRows: cached.insightsRows || [],
    };
    setExpenses(cached.exp || []);
    setWalletTotals(cached.wallets || []);
    setWalletBalances(loadCached(BALANCES_CACHE_KEY, me.email) || []);
    const pending = listPendingExpenses();
    const wallet = selectedWalletRef.current;
    const pendingForList = wallet ? pending.filter((p) => p.wallet === wallet) : pending;
    setInsights(
      computeInsights({ period: periodRef.current, rows: [...pendingForList, ...(cached.insightsRows || [])] })
    );
  }

  // --- Auth bootstrap ---------------------------------------------------
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get("token");
    const urlError = params.get("authError");
    const urlOpen = params.get("open");
    if (urlToken) setToken(urlToken);
    if (urlError) setAuthError(urlError);
    // Deep link for Shortcuts/Action Button, e.g. "?open=wallets" — the
    // state is set now regardless of auth (harmless if !user, since
    // LoginScreen renders instead below), so it's already true by the time
    // the main screen mounts and shows the sheet immediately after login.
    if (urlOpen === "wallets") setWalletsOpen(true);
    if (urlToken || urlError || urlOpen) {
      const url = new URL(window.location.href);
      url.searchParams.delete("token");
      url.searchParams.delete("authError");
      url.searchParams.delete("open");
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

  // Pulls the account's saved theme in once, on first login on this device
  // (e.g. this browser has never touched the local "traty-theme" mirror) —
  // not on every user refresh, so it can't clobber a change made locally
  // later in the same session while a stale fetchMe() is still in flight.
  useEffect(() => {
    if (!user || themeSyncedRef.current) return;
    themeSyncedRef.current = true;
    if (user.theme && user.theme !== theme) {
      setTheme(user.theme);
      setLocalTheme(user.theme);
    }
  }, [user]);

  function changeTheme(value) {
    setTheme(value);
    setLocalTheme(value);
    saveThemeSetting(value).catch(() => {
      // Best-effort account sync — the local choice (already applied above)
      // is what matters for this device; a failed PUT just means another
      // device won't see the change until it succeeds later.
    });
  }

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
    // Totals/insights drop an excluded row immediately, but the rendered
    // list keeps it a beat longer (ROW_EXIT_MS) so ExpenseRow can play its
    // exit animation instead of the row just vanishing the instant the
    // numbers update — see exitingRef's comment above.
    let baseExp = excluded.size ? exp.filter((e) => !excluded.has(e.id) || exitingRef.current.has(e.id)) : exp;
    let baseInsightsRows = excluded.size ? insightsRows.filter((r) => !excluded.has(r.id)) : insightsRows;

    // The toggle only makes sense (and only shows) once there's actually a
    // foreign row loaded — checked against the unfiltered data so it stays
    // available even while the filter itself is hiding those rows.
    const otherAuthor =
      !!user &&
      (baseExp.some((e) => e.user_id != null && e.user_id !== user.id) ||
        baseInsightsRows.some((r) => r.user_id != null && r.user_id !== user.id));
    setHasOtherAuthor(otherAuthor);

    // "Только мои" hides the other account's rows from the visible list —
    // it must NOT shrink baseInsightsRows too: category/wallet totals and
    // limits (computeInsights below) are shared-wallet figures, not scoped
    // to one account, so they stay computed from the full row set
    // regardless of this toggle.
    if (onlyMineRef.current && user) {
      baseExp = baseExp.filter((e) => e.user_id === user.id);
    }

    // A synced-shadow row (real server id already) can briefly coexist with
    // that same row freshly arrived in baseExp/baseInsightsRows —
    // clearConfirmedSynced only drops the shadow once a refetch *issued
    // after* the sync lands, but a refetch issued earlier can still resolve
    // later (cold start, browser's per-origin connection cap) and
    // legitimately already contain it. Drop any shadow/queued row the fresh
    // data already has for real rather than relying on that timing alone,
    // so it never renders, counts toward a total, or feeds insights twice.
    const baseIds = new Set(baseExp.map((e) => e.id));
    const insightsBaseIds = new Set(baseInsightsRows.map((e) => e.id));
    const unconfirmedForList = pendingForList.filter((p) => !baseIds.has(p.id));
    const mergedExpenses = [...unconfirmedForList, ...baseExp].map((e) =>
      exitingRef.current.has(e.id) ? { ...e, exiting: true } : e
    );

    const pendingByWallet = new Map();
    for (const p of pending) {
      if (baseIds.has(p.id)) continue;
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
      if (insightsBaseIds.has(p.id)) return false;
      const createdAt = new Date(p.created_at);
      return createdAt >= periodStart && createdAt < periodEnd;
    });
    setInsights(computeInsights({ period: currentPeriod, rows: [...pendingInPeriod, ...baseInsightsRows] }));
    setPendingWalletDeltas(pendingByWallet);
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
      .then(() => refreshAll(periodRef.current, selectedWalletRef.current))
      .then(() => {
        // Only lift the exclusion once refreshAll has actually landed fresh
        // data. refreshAll's own cache fast-path re-renders synchronously
        // from whatever was last fetched — which still has this row, since
        // that cache predates the delete — so clearing the exclusion any
        // earlier (e.g. in a .finally() racing refreshAll) let the row
        // flash back for the fraction of a second it took the real fetch
        // to land and exclude it again for good.
        committingRef.current.delete(entry.expense.id);
      });
  }

  // Swipe-delete (ExpenseList) and the edit sheet's delete button both call
  // this. A row that was never synced (still in the offline queue) has
  // nothing to undo on the server, so it's removed immediately instead.
  function requestDeleteExpense(expense) {
    if (expense.pending) {
      exitingRef.current.add(expense.id);
      mergeAndSet(selectedWalletRef.current, periodRef.current);
      setTimeout(() => {
        exitingRef.current.delete(expense.id);
        removePendingExpense(expense.id);
        refreshAll(periodRef.current, selectedWalletRef.current);
      }, ROW_EXIT_MS);
      return;
    }
    if (pendingDeleteRef.current) commitDelete(pendingDeleteRef.current);
    haptic();
    exitingRef.current.add(expense.id);
    // startedAt gives the undo banner's countdown ring a fresh key each
    // time, so swiping a second row while the banner is already showing
    // remounts it instead of leaving it mid-animation from the last one.
    const entry = { expense, startedAt: Date.now(), timeoutId: null };
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
    setTimeout(() => {
      exitingRef.current.delete(expense.id);
      mergeAndSet(selectedWalletRef.current, periodRef.current);
    }, ROW_EXIT_MS);
  }

  // Swiped away instead of waiting out the countdown — commits the deletion
  // right away instead of undoing it, same as the timer reaching zero.
  function dismissUndoBanner() {
    const entry = pendingDeleteRef.current;
    if (!entry) return;
    pendingDeleteRef.current = null;
    setPendingDelete(null);
    commitDelete(entry);
  }

  function undoDelete() {
    const entry = pendingDeleteRef.current;
    if (!entry) return;
    clearTimeout(entry.timeoutId);
    exitingRef.current.delete(entry.expense.id);
    pendingDeleteRef.current = null;
    setPendingDelete(null);
    haptic();
    mergeAndSet(selectedWalletRef.current, periodRef.current);
  }

  // Every call site that needs fresh balances (a debt moving money, a
  // transfer, a manual "Баланс" edit) goes through here so the offline
  // cache always reflects whatever was last actually fetched, not just
  // what refreshAll's own background fetch happened to pull.
  async function refreshWalletBalances() {
    const data = await fetchWalletBalances();
    setWalletBalances(data);
    if (user) saveCached(BALANCES_CACHE_KEY, user.email, data);
    return data;
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
    // Recorded before the request goes out: a sync that completed before
    // this timestamp is guaranteed to be reflected in whatever this fetch
    // comes back with, so clearConfirmedSynced below only ever drops a
    // shadow row once a fetch that could actually see it has landed.
    const fetchStartedAt = Date.now();
    const mySeq = (requestSeqRef.current.get(cacheKey) || 0) + 1;
    requestSeqRef.current.set(cacheKey, mySeq);
    try {
      const [exp, wallets, insightsRows, balances] = await Promise.all([
        fetchExpenses(expenseParams),
        fetchWalletTotals(),
        fetchExpensesRange(start, end, wallet),
        fetchWalletBalances(),
      ]);
      const fresh = { exp, wallets, insightsRows };
      dataCacheRef.current.set(cacheKey, fresh);
      // Persisted regardless of whether this selection is still current —
      // it's just building up the cross-session cache for next time, same
      // as the in-session Map above. Balances aren't part of this
      // per-selection blob (see BALANCES_CACHE_KEY's comment) — cached
      // separately, also regardless of whether this selection is still current.
      if (user) saveCache(cacheKey, fresh, user.email);
      if (user) saveCached(BALANCES_CACHE_KEY, user.email, balances);
      // Discard if the wallet/period was switched away from while this was
      // in flight — a slower response for an abandoned selection (Render's
      // cold start can take tens of seconds) must not clobber rawRef with
      // the wrong wallet's data; the newer selection's own refreshAll call
      // is already responsible for keeping the screen correct. Also discard
      // if a newer refreshAll for this SAME key has since been issued (see
      // requestSeqRef above) — this response is stale even though it's for
      // the right key, and applying it would overwrite whatever that newer
      // call already landed (or will land) with older data.
      if (
        wallet === selectedWalletRef.current &&
        currentPeriod === periodRef.current &&
        requestSeqRef.current.get(cacheKey) === mySeq
      ) {
        rawRef.current = fresh;
        setWalletBalances(balances);
        clearConfirmedSynced(fetchStartedAt);
      }
    } catch {
      // Offline — nothing fresh from the server, keep the last known data
      // and just re-merge whatever's pending below
    }
    if (
      wallet === selectedWalletRef.current &&
      currentPeriod === periodRef.current &&
      requestSeqRef.current.get(cacheKey) === mySeq
    ) {
      mergeAndSet(wallet, currentPeriod);
    }
  }

  useEffect(() => {
    if (!user) return;
    // Fires in the background — the UI above already rendered from cache,
    // so this only silently swaps in fresher numbers once they arrive.
    refreshAll(period, selectedWallet);
  }, [user, period, selectedWallet]);

  // Switching wallets drops the filter — otherwise it silently keeps hiding
  // rows on a wallet the user never toggled it on for.
  useEffect(() => {
    setOnlyMine(false);
  }, [selectedWallet]);

  // No network round-trip needed — same cached rows, just re-merged with the
  // filter flipped.
  useEffect(() => {
    if (!user) return;
    mergeAndSet(selectedWalletRef.current, periodRef.current);
  }, [onlyMine]);

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

  // "Баланс" — the real bank balance, separate from walletBalance above
  // (which is spend-in-period, not what's left). null = not set up for the
  // relevant wallet(s) yet. Selecting "Все счета" sums whatever wallets DO
  // have a balance configured — editing is disabled there since there's no
  // single wallet to write the correction back to. Subtracting
  // pendingWalletDeltas mirrors what mergeAndSet already does to
  // walletTotals, so a delete's undo window (or an offline-queued add)
  // shows up here in the same instant as everywhere else on the card,
  // instead of only after its real server round-trip lands.
  const accountBalanceEntry = selectedWallet
    ? walletBalances.find((b) => b.wallet === selectedWallet)
    : null;
  const accountBalance = selectedWallet
    ? accountBalanceEntry
      ? Number(accountBalanceEntry.current_balance) - (pendingWalletDeltas.get(selectedWallet) || 0)
      : null
    : walletBalances.length
    ? walletBalances.reduce(
        (sum, b) => sum + Number(b.current_balance) - (pendingWalletDeltas.get(b.wallet) || 0),
        0
      )
    : null;

  async function saveAccountBalance(amount) {
    await setWalletBalance(selectedWallet, amount);
    await refreshWalletBalances();
  }

  return (
    <div className={`app ${insightsOpen ? "app-behind" : ""}`}>
      {pendingDelete && (
        <div className="undo-banner" ref={setUndoBannerEl}>
          <UndoTimerRing key={pendingDelete.startedAt} durationMs={UNDO_WINDOW_MS} />
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
            style={chipIcon ? catIconVars(chipIcon.bg, chipIcon.fg) : undefined}
          >
            <CategoryGlyph emoji={chipIcon ? chipIcon.emoji : "💳"} size={20} />
          </span>
          <div className="wallet-chip-text">
            <div className="wallet-chip-name">{selectedWallet || "Все счета"}</div>
            <div className="wallet-chip-balance">
              {accountBalance != null
                ? `${accountBalance.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₸`
                : "—"}
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
          <button
            className="header-icon"
            aria-label="Долги"
            onClick={() => {
              haptic();
              setDebtsOpen(true);
            }}
          >
            <HeaderIcon><rect x="5" y="4" width="14" height="16" rx="2" /><path d="M9 9h6M9 13h4" /><circle cx="15.5" cy="16.5" r="2.5" /></HeaderIcon>
          </button>
          <button
            className="header-icon"
            aria-label="Капитал"
            onClick={() => {
              haptic();
              setCapitalOpen(true);
            }}
          >
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
        <AccountBalanceRow
          balance={accountBalance}
          editable={!!selectedWallet}
          onSave={saveAccountBalance}
        />
        <InsightsButton onOpen={() => setInsightsOpen(true)} />
      </div>

      <ExpenseList
        expenses={expenses}
        onSelect={setEditingExpense}
        onDeleteRequest={requestDeleteExpense}
        currentUserId={user.id}
        showMineToggle={hasOtherAuthor}
        onlyMine={onlyMine}
        onToggleOnlyMine={() => {
          haptic();
          setOnlyMine((v) => !v);
        }}
      />

      <VoiceRecorder
        onSaved={() => refreshAll(period)}
        onManualAdd={() => setAddingExpense(true)}
        onScanned={(items) => setScanItems(items)}
      />

      {insightsOpen && (
        <InsightsSheet
          user={user}
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
          onSaved={(saved) => {
            setAddingExpense(false);
            // Jump to the wallet the expense was actually saved under —
            // otherwise it's saved but invisible, still looking at whatever
            // wallet was selected before.
            if (saved?.wallet && saved.wallet !== selectedWallet) {
              selectWallet(saved.wallet);
            }
          }}
        />
      )}

      {scanItems && (
        <ScanReviewSheet
          items={scanItems}
          onClose={() => setScanItems(null)}
          onCommitted={() => refreshAll(period)}
          onSaved={(saved) => {
            setScanItems(null);
            if (saved?.wallet && saved.wallet !== selectedWallet) {
              selectWallet(saved.wallet);
            }
          }}
        />
      )}

      {settingsOpen && (
        <SettingsSheet
          user={user}
          theme={theme}
          onClose={() => setSettingsOpen(false)}
          onOpenCategories={() => setCategoriesOpen(true)}
          onOpenReminders={() => setRemindersOpen(true)}
          onOpenTheme={() => setThemeOpen(true)}
          onOpenBalanceHistory={() => setBalanceHistoryOpen(true)}
        />
      )}

      {remindersOpen && <RemindersSheet user={user} onClose={() => setRemindersOpen(false)} />}

      {themeOpen && <ThemeSheet theme={theme} onChange={changeTheme} onClose={() => setThemeOpen(false)} />}

      {balanceHistoryOpen && <BalanceHistorySheet user={user} onClose={() => setBalanceHistoryOpen(false)} />}

      {debtsOpen && (
        <DebtsSheet
          user={user}
          refreshKey={debtsRefreshKey}
          onClose={() => setDebtsOpen(false)}
          onOpenNewDebt={() => setNewDebtOpen(true)}
          onOpenDebt={(debt) => setSelectedDebt(debt)}
        />
      )}

      {newDebtOpen && (
        <NewDebtSheet
          onClose={() => setNewDebtOpen(false)}
          onCreated={async () => {
            setNewDebtOpen(false);
            setDebtsRefreshKey((k) => k + 1);
            // A debt tied to a wallet just moved its balance on the backend
            // (see routes/debts.js) — re-fetch so the main screen's "Баланс"
            // and the Счета sheet reflect it immediately, same as a transfer.
            await refreshWalletBalances();
          }}
        />
      )}

      {selectedDebt && (
        <DebtDetailSheet
          debt={selectedDebt}
          user={user}
          currentUserId={user.id}
          onClose={() => setSelectedDebt(null)}
          onChanged={async () => {
            setDebtsRefreshKey((k) => k + 1);
            await refreshWalletBalances();
          }}
        />
      )}

      {capitalOpen && (
        <CapitalSheet
          user={user}
          refreshKey={capitalRefreshKey}
          onClose={() => setCapitalOpen(false)}
          onOpenNew={(prevId) => {
            setNewCapitalPrevId(prevId);
            setNewCapitalOpen(true);
          }}
          onOpenSnapshot={(snapshot, previousTotal) =>
            setSelectedCapitalSnapshot({ snapshot, previousTotal })
          }
        />
      )}

      {newCapitalOpen && (
        <NewCapitalSnapshotSheet
          user={user}
          previousSnapshotId={newCapitalPrevId}
          onClose={() => setNewCapitalOpen(false)}
          onCreated={() => {
            setNewCapitalOpen(false);
            setCapitalRefreshKey((k) => k + 1);
          }}
        />
      )}

      {selectedCapitalSnapshot && (
        <CapitalDetailSheet
          user={user}
          snapshot={selectedCapitalSnapshot.snapshot}
          previousTotal={selectedCapitalSnapshot.previousTotal}
          onClose={() => setSelectedCapitalSnapshot(null)}
          onSaved={() => {
            setSelectedCapitalSnapshot(null);
            setCapitalRefreshKey((k) => k + 1);
          }}
          onDeleted={() => {
            setSelectedCapitalSnapshot(null);
            setCapitalRefreshKey((k) => k + 1);
          }}
        />
      )}

      {categoriesOpen && (
        <CategoriesSheet
          initialWallet={selectedWallet}
          onClose={() => setCategoriesOpen(false)}
          onAdd={(wallet) => setNewCategoryWallet(wallet)}
          onEdit={(wallet, cat) => setEditingCategory({ wallet, ...cat })}
          onDelete={async (wallet, name) => {
            await deleteCategory(wallet, name);
            await reloadCategories();
          }}
        />
      )}

      {(newCategoryWallet || editingCategory) && (
        <NewCategorySheet
          wallet={editingCategory?.wallet || newCategoryWallet}
          initial={editingCategory}
          onClose={() => {
            setNewCategoryWallet(null);
            setEditingCategory(null);
          }}
          onCreated={async () => {
            await reloadCategories();
            setNewCategoryWallet(null);
            setEditingCategory(null);
          }}
        />
      )}

      {walletsOpen && (
        <WalletsSheet
          balances={walletBalances}
          pendingWalletDeltas={pendingWalletDeltas}
          selected={selectedWallet}
          onSelect={selectWallet}
          onAdd={() => setNewWalletOpen(true)}
          onEdit={(wallet) => setEditingWallet(wallet)}
          onClose={() => setWalletsOpen(false)}
          onTransfer={() => setTransferOpen(true)}
        />
      )}

      {transferOpen && (
        <WalletTransferSheet
          initialFrom={selectedWallet}
          onClose={() => setTransferOpen(false)}
          onTransferred={async () => {
            await refreshWalletBalances();
            setTransferOpen(false);
          }}
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
