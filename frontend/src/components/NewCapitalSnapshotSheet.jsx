import { useEffect, useRef, useState } from "react";
import { createCapitalSnapshot, fetchCapitalSnapshot } from "../api";
import { hapticHeavy } from "../haptics";
import { useSwipeDismiss } from "../sheetGestures";
import { loadCached, saveCached } from "../offlineCache";
import CapitalItemsEditor, { emptyRow, rowsFromItems, rowsToItems } from "./CapitalItemsEditor";
import { capitalDetailCacheKey } from "./CapitalDetailSheet";

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

  useEffect(() => {
    if (!previousSnapshotId) return;
    fetchCapitalSnapshot(previousSnapshotId)
      .then((detail) => {
        const loadedAssets = rowsFromItems(detail.items.filter((item) => item.kind === "asset"));
        const loadedLiabilities = rowsFromItems(detail.items.filter((item) => item.kind === "liability"));
        setAssets(loadedAssets.length ? loadedAssets : [emptyRow()]);
        setLiabilities(loadedLiabilities.length ? loadedLiabilities : [emptyRow()]);
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
      await createCapitalSnapshot(items);
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
          <span className="cats-title">Новый снимок</span>
          <span className="icon-button-spacer" />
        </div>

        {loading && <p className="empty-hint">Загрузка…</p>}

        {!loading && (
          <CapitalItemsEditor assets={assets} setAssets={setAssets} liabilities={liabilities} setLiabilities={setLiabilities} />
        )}

        {error && <p className="sheet-error">{error}</p>}

        {!loading && (
          <button className="sheet-close" onClick={handleSave} disabled={saving}>
            {saving ? "Сохраняю…" : "Сохранить"}
          </button>
        )}
      </div>
    </div>
  );
}
