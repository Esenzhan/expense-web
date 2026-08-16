import { useEffect, useRef, useState } from "react";
import { fetchBalanceHistory } from "../api";
import { getWalletIcon } from "../wallets";
import { almaty } from "../insights";
import { haptic } from "../haptics";
import { useSwipeDismissRight } from "../sheetGestures";
import CategoryGlyph from "./CategoryGlyph";
import { catIconVars } from "../catIconVars";
import { loadCached, saveCached } from "../offlineCache";

const CACHE_KEY = "traty-balance-history-cache-v1";

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

function formatWhen(iso) {
  const shifted = almaty(new Date(iso));
  const date = shifted.toLocaleDateString("ru-RU", { day: "2-digit", month: "short", timeZone: "UTC" });
  const time = shifted.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
  return `${date}, ${time}`;
}

// «История балансов» (Настройки → Основные): every manual "Баланс" edit and
// every transfer leg, so a base_amount lost to a future bug/bad edit is
// always recoverable by reading back what it used to be — see App.jsx's
// balance-history feature note for why this exists instead of a periodic
// snapshot job.
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
        <p className="empty-hint">Пока пусто — правки баланса и переводы будут появляться здесь.</p>
      )}

      {!loading && rows.length > 0 && (
        <div className="settings-group">
          {rows.map((row) => {
            const icon = getWalletIcon(row.wallet);
            return (
              <div className="settings-row balance-history-row" key={row.id}>
                <span className="category-icon" style={catIconVars(icon.bg, icon.fg)}>
                  <CategoryGlyph emoji={icon.emoji} size={18} />
                </span>
                <span className="balance-history-main">
                  <span className="balance-history-title">
                    {row.wallet} · {reasonLabel(row)}
                  </span>
                  <span className="balance-history-sub">
                    {row.old_amount != null ? `${formatAmount(row.old_amount)} → ` : ""}
                    {formatAmount(row.new_amount)}
                    {row.changed_by_name ? ` · ${row.changed_by_name}` : ""}
                  </span>
                </span>
                <span className="balance-history-when">{formatWhen(row.changed_at)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
