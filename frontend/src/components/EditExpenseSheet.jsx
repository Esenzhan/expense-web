import { useReducer, useRef, useState } from "react";
import { createExpense, updateExpense, deleteExpense } from "../api";
import { CATEGORIES, getCategoryIcon } from "../categoryIcons";
import { WALLETS } from "../wallets";
import { haptic } from "../haptics";
import { useBodyScrollLock, useSwipeDismiss } from "../sheetGestures";

function toNumber(raw) {
  return parseFloat(raw.replace(",", ".")) || 0;
}

function applyOp(a, b, op) {
  if (op === "+") return a + b;
  if (op === "−") return a - b;
  if (op === "×") return a * b;
  if (op === "÷") return b !== 0 ? a / b : a;
  return b;
}

// Groups the integer part with spaces while the user is still typing
// (e.g. a trailing "," must survive re-formatting).
function formatDisplay(raw) {
  const hasComma = raw.includes(",");
  const [intPart, decPart = ""] = raw.split(",");
  const grouped = (intPart || "0").replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return hasComma ? `${grouped},${decPart}` : grouped;
}

// A plain useState per field would let rapid/batched presses (React 18
// batches state updates within one tick) read a stale `display` closure and
// silently drop keystrokes. useReducer guarantees every action sees the
// result of the one before it.
function calcReducer(state, action) {
  switch (action.type) {
    case "digit": {
      if (state.overwrite) return { ...state, display: action.value, overwrite: false };
      if (state.display === "0") return { ...state, display: action.value };
      if (state.display.replace(",", "").length >= 9) return state;
      return { ...state, display: state.display + action.value };
    }
    case "comma": {
      if (state.overwrite) return { ...state, display: "0,", overwrite: false };
      if (state.display.includes(",")) return state;
      return { ...state, display: state.display + "," };
    }
    case "backspace":
      return { ...state, display: state.display.length > 1 ? state.display.slice(0, -1) : "0" };
    case "operator": {
      const current = toNumber(state.display);
      if (state.pendingOp && !state.overwrite) {
        const result = applyOp(state.stored, current, state.pendingOp);
        return { display: String(result), stored: result, pendingOp: action.value, overwrite: true };
      }
      return { ...state, stored: current, pendingOp: action.value, overwrite: true };
    }
    default:
      return state;
  }
}

export default function EditExpenseSheet({ expense, onClose, onSaved, onDeleted }) {
  const isNew = !expense;
  const [calc, dispatch] = useReducer(calcReducer, {
    display: isNew ? "0" : String(Number(expense.amount)),
    stored: null,
    pendingOp: null,
    overwrite: false,
  });
  const [wallet, setWallet] = useState(expense?.wallet || WALLETS[0]);
  const [category, setCategory] = useState(expense?.category || CATEGORIES[0]);
  const [note, setNote] = useState(expense?.description || "");
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const sheetRef = useRef(null);
  useBodyScrollLock();
  useSwipeDismiss(sheetRef, onClose);

  function press(action) {
    haptic();
    dispatch(action);
  }

  function finalAmount() {
    const current = toNumber(calc.display);
    return calc.pendingOp ? applyOp(calc.stored, current, calc.pendingOp) : current;
  }

  const icon = getCategoryIcon(category);

  async function handleSave() {
    const amount = finalAmount();
    if (!(amount > 0)) {
      setError("Сумма должна быть больше нуля");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const payload = { wallet, amount, category, description: note || null };
      const saved = isNew ? await createExpense(payload) : await updateExpense(expense.id, payload);
      onSaved?.(saved);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  async function handleDelete() {
    setSaving(true);
    try {
      await deleteExpense(expense.id);
      onDeleted?.();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="edit-sheet" ref={sheetRef} onClick={(event) => event.stopPropagation()}>
        <div className="edit-header">
          <button className="icon-button" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
          <span className="expense-type-badge">↗ Расход</span>
          {isNew ? (
            <span className="icon-button-spacer" />
          ) : (
            <div className="edit-menu-wrap">
              <button
                className="icon-button"
                onClick={() => {
                  setMenuOpen((open) => !open);
                  setConfirmDelete(false);
                }}
                aria-label="Меню"
              >
                ⋮
              </button>
              {menuOpen && (
                <div className="edit-menu">
                  <button
                    className="menu-item danger"
                    onClick={confirmDelete ? handleDelete : () => setConfirmDelete(true)}
                    disabled={saving}
                  >
                    {confirmDelete ? "Точно удалить?" : "Удалить"} 🗑
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="edit-amount">{formatDisplay(calc.display)} ₸</div>

        <div className="edit-wallet-row">
          <span className="category-icon" style={{ background: icon.bg, color: icon.fg }}>
            {icon.emoji}
          </span>
          <select
            className="wallet-select"
            value={wallet}
            onChange={(event) => setWallet(event.target.value)}
          >
            {WALLETS.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </div>

        <input
          className="note-input"
          type="text"
          placeholder="Заметка"
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />

        <div className="category-row">
          {CATEGORIES.map((cat) => {
            const catIcon = getCategoryIcon(cat);
            return (
              <button
                key={cat}
                className={`category-pick ${category === cat ? "selected" : ""}`}
                style={{ background: catIcon.bg, color: catIcon.fg }}
                onClick={() => setCategory(cat)}
                aria-label={cat}
              >
                {catIcon.emoji}
              </button>
            );
          })}
        </div>
        <div className="category-caption" style={{ color: icon.fg }}>
          {category}
        </div>

        {error && <p className="sheet-error">{error}</p>}

        <div className="keypad">
          {["1", "2", "3"].map((d) => (
            <button key={d} className="key" onClick={() => press({ type: "digit", value: d })}>
              {d}
            </button>
          ))}
          <button className="key op" onClick={() => press({ type: "operator", value: "+" })}>
            +
          </button>
          {["4", "5", "6"].map((d) => (
            <button key={d} className="key" onClick={() => press({ type: "digit", value: d })}>
              {d}
            </button>
          ))}
          <button className="key op" onClick={() => press({ type: "operator", value: "−" })}>
            −
          </button>
          {["7", "8", "9"].map((d) => (
            <button key={d} className="key" onClick={() => press({ type: "digit", value: d })}>
              {d}
            </button>
          ))}
          <button className="key op" onClick={() => press({ type: "operator", value: "×" })}>
            ×
          </button>
          <button className="key" onClick={() => press({ type: "comma" })}>
            ,
          </button>
          <button className="key" onClick={() => press({ type: "digit", value: "0" })}>
            0
          </button>
          <button className="key" onClick={() => press({ type: "backspace" })} aria-label="Стереть">
            ⌫
          </button>
          <button className="key op" onClick={() => press({ type: "operator", value: "÷" })}>
            ÷
          </button>
        </div>

        <button className="sheet-close" onClick={handleSave} disabled={saving}>
          {saving ? "Сохраняю…" : "Сохранить"}
        </button>
      </div>
    </div>
  );
}
