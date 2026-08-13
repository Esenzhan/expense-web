import { useEffect, useRef, useState } from "react";
import { searchExpenses } from "../api";
import { getCategoryIcon } from "../categoryIcons";
import { almaty } from "../insights";
import CategoryGlyph from "./CategoryGlyph";
import { useSwipeDismiss } from "../sheetGestures";
import { catIconVars } from "../catIconVars";

const SEARCH_DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 1;

function shortDate(dateStr) {
  return almaty(new Date(dateStr)).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

// Free-text search over the whole history (not period-bounded), scoped to
// whichever wallet is currently selected on the main screen — matches how
// every other view on the main screen is already scoped.
export default function SearchSheet({ wallet, currentUserId, onSelect, onClose }) {
  const sheetRef = useRef(null);
  useSwipeDismiss(sheetRef, onClose);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null); // null = nothing searched yet
  const [loading, setLoading] = useState(false);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setResults(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const requestId = ++requestIdRef.current;
    const timer = setTimeout(() => {
      searchExpenses(trimmed, wallet)
        .then((rows) => {
          if (requestIdRef.current === requestId) setResults(rows);
        })
        .catch(() => {
          if (requestIdRef.current === requestId) setResults([]);
        })
        .finally(() => {
          if (requestIdRef.current === requestId) setLoading(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, wallet]);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="categories-sheet" ref={sheetRef} onClick={(event) => event.stopPropagation()}>
        <div className="cats-header">
          <button className="icon-button" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
          <span className="cats-title">Поиск</span>
          <span className="icon-button-spacer" />
        </div>

        <input
          className="note-input"
          type="text"
          inputMode="search"
          autoFocus
          placeholder={wallet ? `Поиск по «${wallet}»` : "Поиск по всем счетам"}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />

        <div className="search-results">
          {results === null && !loading && (
            <p className="empty-hint">Начни вводить — категория, заметка или сумма.</p>
          )}
          {loading && <div className="sheet-spinner" />}
          {results !== null && !loading && results.length === 0 && (
            <p className="empty-hint">Ничего не найдено.</p>
          )}
          {results !== null && !loading && results.length > 0 && (
            <div className="search-result-list">
              {results.map((expense) => {
                const icon = getCategoryIcon(expense.wallet, expense.category);
                // Shared-wallet rows from the other account show up here
                // too, but only whoever logged them can edit/delete —
                // same rule as the main list (ExpenseRow's `readonly`).
                const readonly = expense.user_id != null && expense.user_id !== currentUserId;
                return (
                  <button
                    className={`search-result-row ${readonly ? "readonly" : ""}`}
                    key={expense.id}
                    onClick={() => !readonly && onSelect(expense)}
                  >
                    <span className="category-icon" style={catIconVars(icon.bg, icon.fg)}>
                      <CategoryGlyph emoji={icon.emoji} size={18} />
                    </span>
                    <span className="search-result-text">
                      <span className="search-result-head">
                        <span className="search-result-category">{expense.category}</span>
                        <span className="search-result-amount">
                          −{Number(expense.amount).toLocaleString("ru-RU")} ₸
                        </span>
                      </span>
                      <span className="search-result-sub">
                        {expense.description ? `${expense.description} · ` : ""}
                        {expense.wallet} · {shortDate(expense.created_at)}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
