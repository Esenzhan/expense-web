import { useRef, useState } from "react";
import { createWallet, updateWallet, deleteWallet } from "../api";
import { haptic, hapticHeavy, withHaptic } from "../haptics";
import { useSwipeDismiss } from "../sheetGestures";
import CategoryGlyph from "./CategoryGlyph";
import { catIconVars } from "../catIconVars";
import { PALETTE, ICON_GROUPS } from "../pickerOptions";

const SUGGESTION_KEYWORDS = [
  { match: ["бизнес", "работ", "ип", "компан"], icons: ["🤝", "💼", "🏢", "📊"] },
  { match: ["личн", "кошел"], icons: ["👛", "💳", "💵"] },
  { match: ["сем", "дет", "реб"], icons: ["👨‍👩‍👧", "👶", "🏠"] },
  { match: ["ремонт", "стройк"], icons: ["🔨", "🛠️", "🏠"] },
  { match: ["наличн", "кэш"], icons: ["💵", "💰"] },
  { match: ["накоплен", "копилк", "сбереж"], icons: ["🐷", "💰", "📈"] },
  { match: ["отпуск", "путешеств", "поездк"], icons: ["✈️", "🏖️"] },
  { match: ["машин", "авто"], icons: ["🚗"] },
  { match: ["свадьб"], icons: ["💍"] },
  { match: ["учеб", "образован"], icons: ["🎓"] },
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

// Creates a wallet, or edits `initial` when passed (the pencil flow)
export default function NewWalletSheet({ initial, onClose, onSaved, onDeleted }) {
  const sheetRef = useRef(null);
  useSwipeDismiss(sheetRef, onClose);

  const [name, setName] = useState(initial?.name || "");
  const [emoji, setEmoji] = useState(initial?.emoji || "");
  const [colorIndex, setColorIndex] = useState(() => {
    const found = PALETTE.findIndex((p) => p.bg === initial?.bg && p.fg === initial?.fg);
    return found >= 0 ? found : 5;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const color = PALETTE[colorIndex];
  const suggestions = suggestionsFor(name);

  async function handleSave() {
    if (!name.trim()) {
      setError("Введи название счёта");
      return;
    }
    if (!emoji) {
      setError("Выбери иконку");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const payload = { name: name.trim(), emoji, bg: color.bg, fg: color.fg };
      if (initial) await updateWallet(initial.name, payload);
      else await createWallet(payload);
      hapticHeavy();
      onSaved(payload.name, initial?.name);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirmingDelete) {
      haptic();
      setConfirmingDelete(true);
      return;
    }
    setSaving(true);
    setError("");
    try {
      await deleteWallet(initial.name);
      hapticHeavy();
      onDeleted(initial.name);
    } catch (err) {
      setError(err.message);
      setSaving(false);
      setConfirmingDelete(false);
    }
  }

  return (
    <div className="sheet-backdrop" onClick={withHaptic(onClose)}>
      <div className="categories-sheet" ref={sheetRef} onClick={(event) => event.stopPropagation()}>
        <div className="cats-header">
          <button className="icon-button" onClick={withHaptic(onClose)} aria-label="Закрыть">
            ✕
          </button>
          <span className="cats-title">{initial ? "Счёт" : "Новый счет"}</span>
          <span className="icon-button-spacer" />
        </div>

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
            placeholder="Название счёта"
            value={name}
            maxLength={40}
            onChange={(event) => setName(event.target.value)}
          />
        </div>

        {suggestions.length > 0 && (
          <>
            <p className="newcat-suggestions-label">Suggestions</p>
            <div className="newcat-suggestions">
              {suggestions.map((icon) => (
                <button
                  key={icon}
                  className={`newcat-icon ${emoji === icon ? "picked" : ""}`}
                  style={{ "--cat-bg": color.bg }}
                  onClick={() => {
                    haptic();
                    setEmoji(icon);
                  }}
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
                    onClick={() => {
                      haptic();
                      setEmoji(icon);
                    }}
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

        {initial && initial.name !== "Личные" && (
          <button className="sheet-delete" onClick={handleDelete} disabled={saving}>
            {confirmingDelete ? "Точно удалить счёт?" : "Удалить счёт"}
          </button>
        )}
      </div>
    </div>
  );
}
