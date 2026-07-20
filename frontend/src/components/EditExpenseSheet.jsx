import { useEffect, useReducer, useRef, useState } from "react";
import { createExpense, updateExpense, deleteExpense, isNetworkError } from "../api";
import { enqueueExpense, updatePendingExpense, removePendingExpense } from "../offlineQueue";
import { listCategories, getCategoryIcon } from "../categoryIcons";
import CategoryGlyph from "./CategoryGlyph";
import { listWallets } from "../wallets";
import { haptic, hapticTick } from "../haptics";
import { useSwipeDismiss } from "../sheetGestures";

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

const OPS = ["+", "−", "×", "÷"];
const isOp = (token) => OPS.includes(token);

// The calculator works like the reference: the whole chain is kept as
// tokens ("200", "+", "500", "×", "5", …), evaluated strictly left to right
// (no operator precedence — matches the reference's math), the full
// expression is shown in a strip above the amount, and the big number is
// the live running result.
function evaluateTokens(tokens) {
  let acc = null;
  let op = null;
  for (const token of tokens) {
    if (isOp(token)) {
      op = token;
      continue;
    }
    const value = toNumber(token);
    acc = acc === null ? value : applyOp(acc, value, op);
  }
  return acc ?? 0;
}

// Evaluated result back into a display string ("125.5" → "125,5"),
// rounded so long division chains don't overflow the big display.
function resultToDisplay(value) {
  return String(Math.round(value * 100) / 100).replace(".", ",");
}

// useReducer (not useState) so rapid/batched key presses each see the
// result of the previous one — with plain state, React 18's batching made
// fast typing read stale closures and drop keystrokes.
function calcReducer(state, action) {
  const tokens = [...state.tokens];
  const last = tokens[tokens.length - 1];
  switch (action.type) {
    case "digit": {
      if (isOp(last)) return { tokens: [...tokens, action.value] };
      if (last.replace(",", "").length >= 9) return state;
      tokens[tokens.length - 1] = last === "0" ? action.value : last + action.value;
      return { tokens };
    }
    case "comma": {
      if (isOp(last)) return { tokens: [...tokens, "0,"] };
      if (last.includes(",")) return state;
      tokens[tokens.length - 1] = last + ",";
      return { tokens };
    }
    case "operator": {
      if (isOp(last)) {
        tokens[tokens.length - 1] = action.value; // retap = swap the operator
        return { tokens };
      }
      return { tokens: [...tokens, action.value] };
    }
    case "backspace": {
      if (isOp(last)) {
        tokens.pop();
        return { tokens };
      }
      if (last.length > 1) {
        tokens[tokens.length - 1] = last.slice(0, -1);
        return { tokens };
      }
      if (tokens.length > 1) {
        tokens.pop(); // single-digit operand gone; next tap removes the operator
        return { tokens };
      }
      return { tokens: ["0"] };
    }
    default:
      return state;
  }
}

export default function EditExpenseSheet({ expense, defaultWallet, onClose, onSaved, onDeleted }) {
  const isNew = !expense;
  const isPending = Boolean(expense?.pending);
  const [calc, dispatch] = useReducer(calcReducer, {
    tokens: [isNew ? "0" : String(Number(expense.amount)).replace(".", ",")],
  });
  const walletNames = listWallets().map((w) => w.name);
  const [wallet, setWallet] = useState(expense?.wallet || defaultWallet || walletNames[0]);
  const categoryNames = listCategories().map((c) => c.name);
  const [category, setCategory] = useState(expense?.category || categoryNames[0]);
  const [note, setNote] = useState(expense?.description || "");
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const sheetRef = useRef(null);
  useSwipeDismiss(sheetRef, onClose);

  // Category picker is a center-snap carousel: whatever icon sits in the
  // middle of the row is the selected category, like the reference app.
  const categoryRowRef = useRef(null);
  const categoryRef = useRef(category);
  categoryRef.current = category;

  function centerOf(row, index) {
    const child = row.children[index];
    return child ? child.offsetLeft - row.clientWidth / 2 + child.offsetWidth / 2 : 0;
  }

  useEffect(() => {
    // Start with the current category centered (no animation on mount)
    const row = categoryRowRef.current;
    if (row) {
      row.scrollLeft = centerOf(row, categoryNames.indexOf(categoryRef.current));
      applyCarouselScales(row, row.scrollLeft + row.clientWidth / 2);
    }
  }, []);

  // Like the reference: each tile's scale follows the scroll position
  // continuously — full size fades in as the tile approaches the center,
  // not with a discrete jump once it snaps. Styles are written directly to
  // the DOM (not through React state) so every scroll event repaints
  // without a re-render.
  function applyCarouselScales(row, middle) {
    for (const child of row.children) {
      const distance = Math.abs(child.offsetLeft + child.offsetWidth / 2 - middle);
      const step = child.offsetWidth + 10; // tile + flex gap
      // Grow only within 0.8 of a slot from the center: the snap position
      // can settle a couple px off-center, and without this dead zone the
      // neighbor tile kept a visible residual enlargement at rest
      const proximity = Math.max(0, 1 - distance / (step * 0.8));
      // Unselected rest at 0.9x, the centered tile at 1.4x
      child.style.transform = `scale(${0.9 + 0.5 * proximity})`;
      child.style.opacity = `${0.65 + 0.35 * proximity}`;
    }
  }

  function onCategoryScroll() {
    const row = categoryRowRef.current;
    if (!row) return;
    const middle = row.scrollLeft + row.clientWidth / 2;
    applyCarouselScales(row, middle);
    let bestIndex = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < row.children.length; i++) {
      const child = row.children[i];
      const distance = Math.abs(child.offsetLeft + child.offsetWidth / 2 - middle);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = i;
      }
    }
    const centered = categoryNames[bestIndex];
    if (centered && centered !== categoryRef.current) {
      setCategory(centered);
      hapticTick();
    }
  }

  function scrollCategoryTo(index) {
    const row = categoryRowRef.current;
    if (row) row.scrollTo({ left: centerOf(row, index), behavior: "smooth" });
  }

  function press(action) {
    haptic();
    dispatch(action);
  }

  function finalAmount() {
    return evaluateTokens(calc.tokens);
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
    const payload = { wallet, amount, category, description: note || null };
    try {
      let saved;
      if (isNew) {
        try {
          saved = await createExpense(payload);
        } catch (err) {
          if (!isNetworkError(err)) throw err;
          // Offline: keep it on the phone and sync once we're back online —
          // manual add shouldn't require a connection
          saved = enqueueExpense(payload);
        }
      } else if (isPending) {
        saved = updatePendingExpense(expense.id, payload);
      } else {
        saved = await updateExpense(expense.id, payload);
      }
      onSaved?.(saved);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  async function handleDelete() {
    setSaving(true);
    try {
      if (isPending) {
        removePendingExpense(expense.id);
      } else {
        await deleteExpense(expense.id);
      }
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

        <div className="edit-amount-zone">
          {calc.tokens.length > 1 && (
            <div className="calc-expression">
              {calc.tokens.map((t) => (isOp(t) ? t : formatDisplay(t))).join(" ")}
            </div>
          )}
          <div className="edit-amount">
            {formatDisplay(calc.tokens.length === 1 ? calc.tokens[0] : resultToDisplay(evaluateTokens(calc.tokens)))} ₸
          </div>
        </div>

        <div className="edit-wallet-row">
          <span className="category-icon" style={{ background: icon.bg, color: icon.fg }}>
            <CategoryGlyph emoji={icon.emoji} size={20} />
          </span>
          <select
            className="wallet-select"
            value={wallet}
            onChange={(event) => setWallet(event.target.value)}
          >
            {walletNames.map((w) => (
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

        <div className="category-row" ref={categoryRowRef} onScroll={onCategoryScroll}>
          {categoryNames.map((cat, index) => {
            const catIcon = getCategoryIcon(cat);
            return (
              <button
                key={cat}
                className="category-pick"
                style={{ background: catIcon.bg, color: catIcon.fg }}
                onClick={() => scrollCategoryTo(index)}
                aria-label={cat}
              >
                <CategoryGlyph emoji={catIcon.emoji} />
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
