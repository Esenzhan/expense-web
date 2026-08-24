import { useRef, useState } from "react";
import { createCategory, updateCategory } from "../api";
import { haptic, hapticHeavy } from "../haptics";
import { useSwipeDismiss } from "../sheetGestures";
import CategoryGlyph from "./CategoryGlyph";
import { catIconVars } from "../catIconVars";
import { PALETTE, ICON_GROUPS } from "../pickerOptions";

// Typing a name surfaces matching icons, like the reference's Suggestions row
const SUGGESTION_KEYWORDS = [
  { match: ["дом", "быт", "кварти", "жиль"], icons: ["🏠", "🛋️", "🛏️", "🚪", "🧹", "💡", "🔧"] },
  { match: ["кофе", "чай"], icons: ["☕", "🧁"] },
  { match: ["еда", "обед", "ресторан", "кафе"], icons: ["🍴", "🍕", "🍱", "🍜"] },
  { match: ["продукт", "магаз"], icons: ["🛒", "🍎", "🥡"] },
  { match: ["спорт", "трениров", "зал", "фитнес"], icons: ["🏋️", "⚽", "🧘"] },
  { match: ["такси", "убер"], icons: ["🚕"] },
  { match: ["авто", "машин", "бензин"], icons: ["🚗", "⛽"] },
  { match: ["путешеств", "отпуск", "поездк"], icons: ["✈️", "🚄", "⛴️"] },
  { match: ["подписк", "сервис"], icons: ["🔄", "📱", "🎬"] },
  { match: ["дет", "реб", "малыш"], icons: ["👶", "🎁"] },
  { match: ["живот", "кот", "собак", "питом"], icons: ["🐶", "🐱"] },
  { match: ["красот", "уход", "салон"], icons: ["💄", "💆", "✂️"] },
  { match: ["образован", "курс", "учеб", "школ"], icons: ["🎓", "📚"] },
  { match: ["здоров", "аптек", "врач", "стомат"], icons: ["💊", "🏥", "🦷"] },
  { match: ["подар"], icons: ["🎁", "💍", "🎄"] },
  { match: ["работ", "офис"], icons: ["💼", "📦"] },
];

function suggestionsFor(name) {
  const query = name.trim().toLowerCase();
  if (query.length < 2) return [];
  const found = [];
  for (const rule of SUGGESTION_KEYWORDS) {
    if (rule.match.some((m) => query.includes(m))) {
      for (const icon of rule.icons) if (!found.includes(icon)) found.push(icon);
    }
  }
  return found.slice(0, 10);
}

// `initial` (existing category {name, emoji, bg, fg}) switches this into
// edit mode: color/icon only, name is locked — renaming isn't offered here.
// Expenses reference a category by name and look up its look-up-by-name
// bg/fg/emoji at render time (see categoryIcons.js), so saving here updates
// every expense that uses this category everywhere in the app, automatically.
export default function NewCategorySheet({ wallet, initial, onClose, onCreated }) {
  const sheetRef = useRef(null);
  useSwipeDismiss(sheetRef, onClose);

  const [name, setName] = useState(initial?.name || "");
  const [emoji, setEmoji] = useState(initial?.emoji || "");
  const [colorIndex, setColorIndex] = useState(() => {
    if (!initial) return 1;
    const found = PALETTE.findIndex((p) => p.bg === initial.bg && p.fg === initial.fg);
    return found === -1 ? 0 : found;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const color = PALETTE[colorIndex];
  const suggestions = initial ? [] : suggestionsFor(name);

  function pickEmoji(icon) {
    haptic();
    setEmoji(icon);
  }

  async function handleSave() {
    if (!initial && !name.trim()) {
      setError("Введи название категории");
      return;
    }
    if (!emoji) {
      setError("Выбери иконку");
      return;
    }
    setSaving(true);
    setError("");
    try {
      if (initial) {
        await updateCategory(wallet, initial.name, { emoji, bg: color.bg, fg: color.fg });
      } else {
        await createCategory({ name: name.trim(), emoji, bg: color.bg, fg: color.fg, wallet });
      }
      hapticHeavy();
      onCreated();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="categories-sheet" ref={sheetRef} onClick={(event) => event.stopPropagation()}>
        <div className="cats-header">
          <button className="icon-button" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
          <span className="cats-title">{initial ? "Редактировать категорию" : "Новая категория"}</span>
          <span className="icon-button-spacer" />
        </div>

        <p className="newcat-suggestions-label" style={{ textAlign: "center" }}>
          Для счёта «{wallet}»
        </p>

        <button className="parent-category-pill">+ Родительская категория</button>

        <div className="newcat-name-row">
          <span
            className="category-icon"
            style={emoji ? catIconVars(color.bg, color.fg) : { background: "var(--surface-soft)", color: "var(--ink-soft)" }}
          >
            {emoji ? <CategoryGlyph emoji={emoji} size={20} /> : "⃠"}
          </span>
          <input
            className="note-input newcat-name-input"
            type="text"
            placeholder="Название категории"
            value={name}
            maxLength={40}
            disabled={!!initial}
            onChange={(event) => setName(event.target.value)}
          />
        </div>

        <div className="type-toggle">
          <span className="type-side income">↙</span>
          <span className="type-side expense active">↗ Расход</span>
        </div>

        {suggestions.length > 0 && (
          <>
            <p className="newcat-suggestions-label">Рекомендации</p>
            <div className="newcat-suggestions">
              {suggestions.map((icon) => (
                <button
                  key={icon}
                  className={`newcat-icon ${emoji === icon ? "picked" : ""}`}
                  style={catIconVars(color.bg, color.fg)}
                  onClick={() => pickEmoji(icon)}
                >
                  <CategoryGlyph emoji={icon} size={20} />
                </button>
              ))}
            </div>
          </>
        )}

        <div className="palette-row">
          {PALETTE.map((p, index) => (
            <button
              key={p.fg}
              className={`palette-swatch ${index === colorIndex ? "picked" : ""}`}
              style={{ background: p.fg }}
              onClick={() => {
                haptic();
                setColorIndex(index);
              }}
              aria-label="Цвет"
            />
          ))}
        </div>

        <div className="newcat-icon-groups">
          {ICON_GROUPS.map((group) => (
            <div key={group.title}>
              <p className="newcat-group-title">{group.title}</p>
              <div className="newcat-icon-grid">
                {group.icons.map((icon) => (
                  <button
                    key={icon}
                    className={`newcat-icon ${emoji === icon ? "picked" : ""}`}
                    style={catIconVars(color.bg, color.fg)}
                    onClick={() => pickEmoji(icon)}
                  >
                    <CategoryGlyph emoji={icon} size={20} />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {error && <p className="sheet-error">{error}</p>}

        <button className="sheet-close" onClick={handleSave} disabled={saving}>
          {saving ? "Сохраняю…" : "Сохранить"}
        </button>
      </div>
    </div>
  );
}
