import { useRef, useState } from "react";
import { createExpense } from "../api";
import { enqueueExpense, syncPendingExpenses } from "../offlineQueue";
import { getCategoryIcon } from "../categoryIcons";
import CategoryGlyph from "./CategoryGlyph";
import { catIconVars } from "../catIconVars";
import { haptic, hapticHeavy, withHaptic } from "../haptics";
import { useSwipeDismiss } from "../sheetGestures";
import { formatDateHeader } from "./ExpenseList";

function ImageIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <circle cx="8.5" cy="9.5" r="1.6" />
      <path d="m4 17 5-5 4 4 3-3 4 4" />
    </svg>
  );
}

function WalletTagIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="7" rx="7" ry="2.5" />
      <path d="M5 7v10c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V7" />
    </svg>
  );
}

function formatAmount(amount) {
  return `${Number(amount).toLocaleString("ru-RU")} ₸`;
}

function itemsWord(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "запись";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "записи";
  return "записей";
}

// Same wallet + same category merge into one — description keeps every
// original item's name so nothing detected on the receipt gets lost, just
// no longer itemized as separate expenses.
function mergeKey(item) {
  return `${item.wallet}|${item.category}`;
}

function mergeItems(items) {
  const groups = new Map();
  for (const item of items) {
    const key = mergeKey(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return [...groups.values()].map((group) =>
    group.length === 1
      ? group[0]
      : {
          wallet: group[0].wallet,
          category: group[0].category,
          amount: group.reduce((sum, item) => sum + Number(item.amount), 0),
          description: group.map((item) => item.description).filter(Boolean).join(", "),
        }
  );
}

function canMerge(items) {
  const counts = new Map();
  for (const item of items) {
    const key = mergeKey(item);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.values()].some((count) => count > 1);
}

// Post-scan review — "Операции с изображения": every detected item (one for
// a single-total scan, several for "Раздельно") in one list instead of
// stepping through them one at a time, with an optional merge for line
// items that share a category before committing the whole batch at once.
export default function ScanReviewSheet({ items: initialItems, onClose, onCommitted, onSaved }) {
  const [items, setItems] = useState(initialItems);
  const [saving, setSaving] = useState(false);
  const sheetRef = useRef(null);
  useSwipeDismiss(sheetRef, onClose);

  const total = items.reduce((sum, item) => sum + Number(item.amount), 0);
  const mergeable = items.length > 1 && canMerge(items);
  const dateHeader = formatDateHeader(new Date().toISOString());

  function handleMerge() {
    haptic();
    setItems((prev) => mergeItems(prev));
  }

  function handleSave() {
    haptic();
    setSaving(true);
    const saved = items.map((item) =>
      enqueueExpense({
        wallet: item.wallet,
        amount: Number(item.amount),
        category: item.category,
        description: item.description || null,
      })
    );
    hapticHeavy();
    onCommitted?.();
    syncPendingExpenses(createExpense).then((syncedAny) => {
      if (syncedAny) onCommitted?.();
    });
    onSaved?.(saved[saved.length - 1]);
  }

  return (
    <div className="sheet-backdrop" onClick={withHaptic(onClose)}>
      <div className="categories-sheet" ref={sheetRef} onClick={(event) => event.stopPropagation()}>
        <div className="cats-header">
          <button className="icon-button" onClick={withHaptic(onClose)} aria-label="Закрыть" disabled={saving}>
            ✕
          </button>
          <span className="cats-title scan-review-title">
            <ImageIcon /> Операции с изображения
          </span>
          <span className="icon-button-spacer" />
        </div>

        {items.length > 1 && (
          <p className="scan-review-subtitle">
            {items.length} {itemsWord(items.length)}, {formatAmount(total)}
          </p>
        )}

        <div className="expense-group">
          <div className="expense-date-header scan-review-date-header">
            <span>{dateHeader}</span>
            {items.length > 1 && <span>{formatAmount(total)}</span>}
          </div>
          <div className="expense-list">
            {items.map((item, index) => {
              const icon = getCategoryIcon(item.wallet, item.category);
              return (
                <div className="expense-row" key={index}>
                  <span className="category-icon" style={catIconVars(icon.bg, icon.fg)}>
                    <CategoryGlyph emoji={icon.emoji} size={20} />
                  </span>
                  <div className="meta">
                    <span className="category">{item.category}</span>
                    {item.description && <span className="sub">{item.description}</span>}
                    <span className="confirm-wallet scan-wallet-tag">
                      <WalletTagIcon /> {item.wallet}
                    </span>
                  </div>
                  <span className="amount">−{formatAmount(item.amount)}</span>
                </div>
              );
            })}
          </div>
        </div>

        {mergeable && (
          <button type="button" className="scan-merge-btn" onClick={handleMerge} disabled={saving}>
            Объединить операции
          </button>
        )}

        <div className="confirm-actions">
          <button className="btn-secondary" onClick={withHaptic(onClose)} disabled={saving}>
            Отмена
          </button>
          <button className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? "Сохраняю…" : "Сохранить"}
          </button>
        </div>
      </div>
    </div>
  );
}
