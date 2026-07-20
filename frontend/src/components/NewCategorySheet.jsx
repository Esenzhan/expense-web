import { useRef, useState } from "react";
import { createCategory } from "../api";
import { haptic, hapticHeavy } from "../haptics";
import { useSwipeDismiss } from "../sheetGestures";

// bg = pastel tile, fg = strong accent (shown in the palette swatch)
const PALETTE = [
  { bg: "#e9e9ec", fg: "#3a3a40" },
  { bg: "#fde2e1", fg: "#c23b3b" },
  { bg: "#ffe6d1", fg: "#c2681f" },
  { bg: "#fff2cf", fg: "#a9790a" },
  { bg: "#ecf7d4", fg: "#5f8f1f" },
  { bg: "#e1f3e3", fg: "#2f8f4e" },
  { bg: "#d8f5f1", fg: "#1f9e8c" },
  { bg: "#dff0fb", fg: "#1f7fae" },
  { bg: "#e3ecfd", fg: "#2f5fc2" },
  { bg: "#eee3fd", fg: "#7440c2" },
  { bg: "#fde1ef", fg: "#c23b8f" },
  { bg: "#ece3d8", fg: "#8a6a3f" },
];

const ICON_GROUPS = [
  { title: "Покупки", icons: ["🛍️", "👜", "🧥", "👕", "👟", "⌚", "👗", "🧢", "🧦", "👠", "🕶️", "💄"] },
  { title: "Еда", icons: ["🍴", "☕", "🍕", "🍔", "🥗", "🍱", "🍜", "🧁", "🍩", "🍺", "🥡", "🍎"] },
  { title: "Транспорт", icons: ["🚕", "🚌", "🚗", "⛽", "🚲", "✈️", "🚇", "🛴", "🚄", "⛴️"] },
  { title: "Дом", icons: ["🏠", "🛋️", "🛏️", "🚪", "🧹", "🧺", "🔧", "💡", "🪴", "🧴"] },
  { title: "Развлечения", icons: ["🎮", "🎬", "🎵", "🎢", "🎳", "🎨", "📚", "🎟️", "🎤", "⚽"] },
  { title: "Здоровье", icons: ["💊", "🏥", "🦷", "🏋️", "🧘", "💆", "🩺", "🧖"] },
  { title: "Другое", icons: ["💳", "📱", "🎁", "🐶", "🐱", "👶", "🎓", "💼", "✂️", "🌿", "⚡", "💧", "📦", "🔄", "💍", "🎄"] },
];

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

export default function NewCategorySheet({ onClose, onCreated }) {
  const sheetRef = useRef(null);
  useSwipeDismiss(sheetRef, onClose);

  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("");
  const [colorIndex, setColorIndex] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const color = PALETTE[colorIndex];
  const suggestions = suggestionsFor(name);

  function pickEmoji(icon) {
    haptic();
    setEmoji(icon);
  }

  async function handleSave() {
    if (!name.trim()) {
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
      await createCategory({ name: name.trim(), emoji, bg: color.bg, fg: color.fg });
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
          <span className="cats-title">Новая категория</span>
          <span className="icon-button-spacer" />
        </div>

        <button className="parent-category-pill">+ Родительская категория</button>

        <div className="newcat-name-row">
          <span
            className="category-icon"
            style={emoji ? { background: color.bg, color: color.fg } : { background: "#e9e9ec", color: "#5b5b63" }}
          >
            {emoji || "⃠"}
          </span>
          <input
            className="note-input newcat-name-input"
            type="text"
            placeholder="Название категории"
            value={name}
            maxLength={40}
            onChange={(event) => setName(event.target.value)}
          />
        </div>

        <div className="type-toggle">
          <span className="type-side income">↙</span>
          <span className="type-side expense active">↗ Расход</span>
        </div>

        {suggestions.length > 0 && (
          <>
            <p className="newcat-suggestions-label">Suggestions</p>
            <div className="newcat-suggestions">
              {suggestions.map((icon) => (
                <button
                  key={icon}
                  className={`newcat-icon ${emoji === icon ? "picked" : ""}`}
                  style={{ background: color.bg }}
                  onClick={() => pickEmoji(icon)}
                >
                  {icon}
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
                    onClick={() => pickEmoji(icon)}
                  >
                    {icon}
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
