import { useEffect, useRef, useState } from "react";
import { fetchBalanceHistory } from "../api";
import { getWalletIcon } from "../wallets";
import { getCategoryIcon, getIncomeCategoryIcon } from "../categoryIcons";
import { almaty } from "../insights";
import { haptic } from "../haptics";
import { useSwipeDismissRight } from "../sheetGestures";
import CategoryGlyph from "./CategoryGlyph";
import { catIconVars } from "../catIconVars";
import { loadCached, saveCached } from "../offlineCache";

// v2: строки стали событиями журнала (kind/at/balance_after) вместо
// голых правок баланса — старый кэш этой формы уже не соответствует.
const CACHE_KEY = "traty-balance-history-cache-v2";

const REASON_LABEL = {
  manual: "Ручное изменение",
  transfer_out: (row) => `Перевод → ${row.counterpart_wallet}`,
  transfer_in: (row) => `Перевод ← ${row.counterpart_wallet}`,
  // Долги — counterpart_wallet здесь не счёт, а имя должника/кредитора
  // (см. routes/debts.js, logBalanceChange вызовы).
  debt_lend: (row) => `Долг выдан → ${row.counterpart_wallet}`,
  debt_borrow: (row) => `Долг получен ← ${row.counterpart_wallet}`,
  debt_repay_in: (row) => `Долг возвращён ← ${row.counterpart_wallet}`,
  debt_repay_out: (row) => `Долг погашен → ${row.counterpart_wallet}`,
  debt_delete: (row) => `Долг отменён (${row.counterpart_wallet})`,
};

// Что показать в заголовке строки. У траты/дохода это категория и заметка,
// у правки опорной суммы — её причина.
function eventLabel(row) {
  if (row.kind === "expense" || row.kind === "income") {
    return row.description ? `${row.category} · ${row.description}` : row.category;
  }
  return reasonLabel(row);
}

function reasonLabel(row) {
  const label = REASON_LABEL[row.reason];
  if (typeof label === "function") return label(row);
  if (label) return label;
  // Falls back to a de-snake_cased version of the raw reason instead of
  // the literal code, in case a new reason ever ships without its label
  // added here too (this exact gap is why debt_lend/debt_repay_in etc.
  // showed up raw before this fix).
  return row.reason.replace(/_/g, " ");
}

function formatAmount(amount) {
  return `${Number(amount).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₸`;
}

// Знаковая величина движения: трата уменьшает, доход увеличивает.
function formatDelta(row) {
  const sign = row.kind === "income" ? "+" : "−";
  return `${sign}${formatAmount(row.amount)}`;
}

// День траты по-астанински — нужен, только когда он отличается от дня
// записи (трату внесли задним числом или наперёд).
function spentOnAnotherDay(row) {
  if (!row.spent_at) return null;
  const day = (iso) => almaty(new Date(iso)).toISOString().slice(0, 10);
  if (day(row.spent_at) === day(row.at)) return null;
  return almaty(new Date(row.spent_at)).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}

function formatWhen(iso) {
  const shifted = almaty(new Date(iso));
  const date = shifted.toLocaleDateString("ru-RU", { day: "2-digit", month: "short", timeZone: "UTC" });
  const time = shifted.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
  return `${date}, ${time}`;
}

// «История балансов» (Настройки → Основные) — полный журнал движения денег
// по счетам аккаунта: каждая трата и доход плюс каждая правка опорной суммы
// (ручная, перевод, долг), с остатком после каждого события. Так потерянный
// из-за бага или кривой правки base_amount всегда восстановим — достаточно
// отмотать назад и увидеть, каким он был; периодические снимки для этого не
// нужны. Траты подмешивает бэкенд на чтении, а не дублирует строками при
// записи — почему именно так, написано в routes/balanceHistory.js.
export default function BalanceHistorySheet({ user, onClose }) {
  const email = user?.email;
  const [rows, setRows] = useState(() => loadCached(CACHE_KEY, email) || []);
  const [loading, setLoading] = useState(() => !loadCached(CACHE_KEY, email));
  const [error, setError] = useState(null);
  const [closing, setClosing] = useState(false);
  const pageRef = useRef(null);

  useSwipeDismissRight(pageRef, onClose);

  function handleClose() {
    if (closing) return;
    haptic();
    setClosing(true);
    const el = pageRef.current;
    if (el) {
      el.style.transition = "transform 0.26s cubic-bezier(0.2, 0.9, 0.3, 1)";
      el.style.transform = "translateX(100%)";
    }
    setTimeout(onClose, 260);
  }

  useEffect(() => {
    const cached = loadCached(CACHE_KEY, email);
    if (cached) {
      setRows(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }
    fetchBalanceHistory()
      .then((data) => {
        setRows(data);
        setError(null);
        if (email) saveCached(CACHE_KEY, email, data);
      })
      .catch(() => {
        if (!cached) setError("Не удалось загрузить историю");
      })
      .finally(() => setLoading(false));
  }, [email]);

  return (
    <div ref={pageRef} className="settings-page">
      <div className="settings-header">
        <button className="icon-button" onClick={handleClose} aria-label="Назад">
          ‹
        </button>
        <span className="settings-title">История балансов</span>
        <span className="icon-button-spacer" />
      </div>

      {loading && <p className="empty-hint">Загрузка…</p>}
      {error && <p className="reminder-hint reminder-hint-error">{error}</p>}
      {!loading && !error && rows.length === 0 && (
        <p className="empty-hint">Пока пусто — траты, доходы и правки баланса будут появляться здесь.</p>
      )}

      {!loading && rows.length > 0 && (
        <div className="settings-group">
          {rows.map((row) => {
            const isEntry = row.kind === "expense" || row.kind === "income";
            // У траты/дохода иконка категории — по ней строка узнаётся с
            // одного взгляда; у правки баланса категории нет, там иконка счёта.
            const icon = isEntry
              ? row.kind === "income"
                ? getIncomeCategoryIcon(row.wallet, row.category)
                : getCategoryIcon(row.wallet, row.category)
              : getWalletIcon(row.wallet);
            const spentOn = isEntry ? spentOnAnotherDay(row) : null;
            // Слева от стрелки — «с чего», справа — «во что»: у траты это её
            // знаковая величина, у правки — прежняя сумма. Остаток после
            // события считает бэкенд, отматывая от сегодняшнего баланса.
            const from = isEntry
              ? formatDelta(row)
              : row.old_amount != null
              ? formatAmount(row.old_amount)
              : null;
            const to = isEntry
              ? row.balance_after != null
                ? formatAmount(row.balance_after)
                : null
              : formatAmount(row.new_amount);
            return (
              <div className="settings-row balance-history-row" key={row.key}>
                <span className="category-icon" style={catIconVars(icon.bg, icon.fg)}>
                  <CategoryGlyph emoji={icon.emoji} size={18} />
                </span>
                <span className="balance-history-main">
                  <span className="balance-history-title">
                    {row.wallet} · {eventLabel(row)}
                  </span>
                  <span className="balance-history-sub">
                    {from ? `${from}${to ? " → " : ""}` : ""}
                    {to || ""}
                    {spentOn ? ` · трата от ${spentOn}` : ""}
                    {row.changed_by_name ? ` · ${row.changed_by_name}` : ""}
                  </span>
                </span>
                <span className="balance-history-when">{formatWhen(row.at)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
