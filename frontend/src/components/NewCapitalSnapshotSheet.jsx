import { useEffect, useRef, useState } from "react";
import { createCapitalSnapshot, fetchCapitalSnapshot } from "../api";
import { haptic, hapticHeavy, withHaptic } from "../haptics";
import { useSwipeDismiss } from "../sheetGestures";
import { loadCached, saveCached } from "../offlineCache";
import CapitalItemsEditor, { emptyRow, rowsFromItems, rowsToItems, numericRates } from "./CapitalItemsEditor";
import { capitalDetailCacheKey } from "./CapitalDetailSheet";
import DateTimePickerSheet from "./DateTimePickerSheet";
import CalendarIcon from "./CalendarIcon";
import { almaty } from "../insights";

// Дата снимка в заголовке — тот же формат, что в списке «Капитала» и в
// CapitalDetailSheet.
function formatDate(date) {
  return almaty(date).toLocaleDateString("ru-RU", { day: "2-digit", month: "long", timeZone: "UTC" });
}

// «Новый снимок» — свайп-down шторка, две свободные секции (как в их
// таблице: Активы/Обязательства), каждая строка — просто название и сумма,
// без привязки к счетам/категориям сайта. Итог = сумма активов минус сумма
// обязательств, посчитан на бэкенде из этого же набора строк.
//
// Стартует с предзаполненным списком позиций предыдущего снимка (тот же
// набор строк, что уже посчитан в прошлый раз) — обычно от снимка к снимку
// меняются только суммы, редко сам набор пунктов, так что дешевле стереть/
// поправить пару строк, чем набирать всё заново. previousSnapshotId
// приходит от CapitalSheet (id последнего снимка в списке); null у самого
// первого снимка семьи — тогда просто одна пустая строка на секцию, как раньше.
export default function NewCapitalSnapshotSheet({ user, previousSnapshotId, onClose, onCreated }) {
  const email = user?.email;
  const sheetRef = useRef(null);
  useSwipeDismiss(sheetRef, onClose);

  const cachedPrev = previousSnapshotId ? loadCached(capitalDetailCacheKey(previousSnapshotId), email) : null;
  const [assets, setAssets] = useState(() => {
    const rows = cachedPrev ? rowsFromItems(cachedPrev.filter((item) => item.kind === "asset")) : [];
    return rows.length ? rows : [emptyRow()];
  });
  const [liabilities, setLiabilities] = useState(() => {
    const rows = cachedPrev ? rowsFromItems(cachedPrev.filter((item) => item.kind === "liability")) : [];
    return rows.length ? rows : [emptyRow()];
  });
  const [loading, setLoading] = useState(!!previousSnapshotId && !cachedPrev);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // Как у трат (EditExpenseSheet): пока дату не тронули — null, и снимок
  // записывается моментом сохранения. Считают капитал вечером, а заносят
  // через пару дней — цифра принадлежит дню подсчёта, а не дню ввода.
  const [customDate, setCustomDate] = useState(null);
  // Курсы на дату снимка, {USD: "540.5"}. Предзаполняются из предыдущего
  // снимка — от раза к разу курс меняется, но порядок тот же, поправить
  // цифру быстрее, чем вспоминать и набирать заново.
  const [rates, setRates] = useState({});
  const [datePickerOpen, setDatePickerOpen] = useState(false);

  useEffect(() => {
    if (!previousSnapshotId) return;
    fetchCapitalSnapshot(previousSnapshotId)
      .then((detail) => {
        const loadedAssets = rowsFromItems(detail.items.filter((item) => item.kind === "asset"));
        const loadedLiabilities = rowsFromItems(detail.items.filter((item) => item.kind === "liability"));
        setAssets(loadedAssets.length ? loadedAssets : [emptyRow()]);
        setLiabilities(loadedLiabilities.length ? loadedLiabilities : [emptyRow()]);
        if (detail.rates) {
          setRates(Object.fromEntries(Object.entries(detail.rates).map(([k, v]) => [k, String(v)])));
        }
        if (email) saveCached(capitalDetailCacheKey(previousSnapshotId), email, detail.items);
      })
      .catch(() => {
        // couldn't load the previous snapshot (offline, or the request
        // failed) — if it was already cached (hydrated at mount above),
        // that prefill is already showing; otherwise fall back to blank
        // rows, same as if there were no previous snapshot at all
      })
      .finally(() => setLoading(false));
  }, [previousSnapshotId, email]);

  async function handleSave() {
    const items = rowsToItems(assets, liabilities);
    if (!items.length) {
      setError("Добавьте хотя бы одну позицию");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await createCapitalSnapshot(items, customDate ? customDate.toISOString() : null, numericRates(rates));
      hapticHeavy();
      onCreated();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <>
    <div className="sheet-backdrop" onClick={withHaptic(onClose)}>
      <div className="categories-sheet" ref={sheetRef} onClick={(event) => event.stopPropagation()}>
        <div className="cats-header">
          <button className="icon-button" onClick={withHaptic(onClose)} aria-label="Закрыть">
            ✕
          </button>
          <span className="cats-title">{customDate ? formatDate(customDate) : "Новый снимок"}</span>
          <button
            className={`icon-button ${customDate ? "active" : ""}`}
            onClick={() => {
              haptic();
              setDatePickerOpen(true);
            }}
            aria-label="Дата снимка"
          >
            <CalendarIcon />
          </button>
        </div>

        {loading && <p className="empty-hint">Загрузка…</p>}

        {!loading && (
          <CapitalItemsEditor
            assets={assets}
            setAssets={setAssets}
            liabilities={liabilities}
            setLiabilities={setLiabilities}
            rates={rates}
            setRates={setRates}
          />
        )}

        {error && <p className="sheet-error">{error}</p>}

        {!loading && (
          <button className="sheet-close" onClick={handleSave} disabled={saving}>
            {saving ? "Сохраняю…" : "Сохранить"}
          </button>
        )}
      </div>
    </div>

    {datePickerOpen && (
      <DateTimePickerSheet
        initial={customDate || new Date()}
        onClose={() => setDatePickerOpen(false)}
        onApply={(picked) => {
          setCustomDate(picked);
          setDatePickerOpen(false);
        }}
      />
    )}
    </>
  );
}
