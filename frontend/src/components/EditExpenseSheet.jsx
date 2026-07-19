import { useState } from "react";
import { updateExpense, deleteExpense } from "../api";
import { CATEGORIES, getCategoryIcon } from "../categoryIcons";
import { WALLETS } from "../wallets";

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

export default function EditExpenseSheet({ expense, onClose, onSaved, onDeleted }) {
  const [display, setDisplay] = useState(String(Number(expense.amount)));
  const [stored, setStored] = useState(null);
  const [pendingOp, setPendingOp] = useState(null);
  const [overwrite, setOverwrite] = useState(false);
  const [wallet, setWallet] = useState(expense.wallet);
  const [category, setCategory] = useState(expense.category);
  const [note, setNote] = useState(expense.description || "");
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function pressDigit(d) {
    if (overwrite) {
      setDisplay(d);
      setOverwrite(false);
    } else if (display === "0") {
      setDisplay(d);
    } else if (display.replace(",", "").length < 9) {
      setDisplay(display + d);
    }
  }

  function pressComma() {
    if (overwrite) {
      setDisplay("0,");
      setOverwrite(false);
      return;
    }
    if (!display.includes(",")) setDisplay(display + ",");
  }

  function pressBackspace() {
    setDisplay((prev) => (prev.length > 1 ? prev.slice(0, -1) : "0"));
  }

  function pressOperator(op) {
    const current = toNumber(display);
    if (pendingOp && !overwrite) {
      const result = applyOp(stored, current, pendingOp);
      setStored(result);
      setDisplay(String(result));
    } else {
      setStored(current);
    }
    setPendingOp(op);
    setOverwrite(true);
  }

  function finalAmount() {
    const current = toNumber(display);
    return pendingOp ? applyOp(stored, current, pendingOp) : current;
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
      const updated = await updateExpense(expense.id, {
        wallet,
        amount,
        category,
        description: note || null,
      });
      onSaved?.(updated);
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
      <div className="edit-sheet" onClick={(event) => event.stopPropagation()}>
        <div className="edit-header">
          <button className="icon-button" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
          <span className="expense-type-badge">↗ Расход</span>
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
        </div>

        <div className="edit-amount">{formatDisplay(display)} ₸</div>

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
            <button key={d} className="key" onClick={() => pressDigit(d)}>
              {d}
            </button>
          ))}
          <button className="key op" onClick={() => pressOperator("+")}>
            +
          </button>
          {["4", "5", "6"].map((d) => (
            <button key={d} className="key" onClick={() => pressDigit(d)}>
              {d}
            </button>
          ))}
          <button className="key op" onClick={() => pressOperator("−")}>
            −
          </button>
          {["7", "8", "9"].map((d) => (
            <button key={d} className="key" onClick={() => pressDigit(d)}>
              {d}
            </button>
          ))}
          <button className="key op" onClick={() => pressOperator("×")}>
            ×
          </button>
          <button className="key" onClick={pressComma}>
            ,
          </button>
          <button className="key" onClick={() => pressDigit("0")}>
            0
          </button>
          <button className="key" onClick={pressBackspace} aria-label="Стереть">
            ⌫
          </button>
          <button className="key op" onClick={() => pressOperator("÷")}>
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
