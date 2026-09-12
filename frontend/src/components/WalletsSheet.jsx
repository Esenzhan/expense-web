import { useRef, useState } from "react";
import { walletsByScope, isInAllAccounts, walletCurrency, walletScope } from "../wallets";
import { formatMoney, HOME_CURRENCY } from "../currencies";
import { haptic, withHaptic } from "../haptics";
import { useSwipeDismiss } from "../sheetGestures";
import CategoryGlyph from "./CategoryGlyph";
import { DragHandle, useReorderDrag } from "./ReorderDrag";
import { catIconVars } from "../catIconVars";


const GROUP_TITLE = {
  personal: "Личные",
  shared: "Общие счета",
  other: "Другое",
};

// Одна группа счетов со своим перетаскиванием. Отдельный компонент, потому
// что хук перетаскивания нужен каждой группе свой, а хуки нельзя вызывать
// в цикле.
//
// Порядок меняется ТОЛЬКО внутри группы: вытащить счёт из «Личных» в
// «Общие» перетаскиванием нельзя — это смена типа счёта, у неё другие
// последствия (кто его видит, чьи на нём траты), и делается она в шторке
// правки осознанно.
function WalletGroup({ items, selected, balanceOf, formatBalance, onChoose, onEdit, onReorder }) {
  const [localOrder, setLocalOrder] = useState(null);

  // Пока сохранение летит, показываем уже новый порядок; когда приедет свежая
  // гидрация счетов, localOrder сбрасывается сам собой — новый список
  // приходит из пропса, а неизвестные ему имена уезжают в конец.
  const wallets = (() => {
    if (!localOrder) return items;
    const byName = new Map(items.map((w) => [w.name, w]));
    const ordered = localOrder.map((n) => byName.get(n)).filter(Boolean);
    for (const w of items) if (!localOrder.includes(w.name)) ordered.push(w);
    return ordered;
  })();

  const { drag, listRef, rowOffset, onHandleTouchStart } = useReorderDrag(
    wallets.map((w) => w.name),
    (names) => {
      setLocalOrder(names);
      Promise.resolve(onReorder(names)).catch(() => setLocalOrder(null));
    }
  );

  return (
    <div className="cats-list" ref={listRef}>
      {wallets.map((wallet, index) => (
        <div
          className={`wallet-row-wrap ${drag?.from === index ? "dragging" : ""}`}
          key={wallet.name}
          style={{ transform: `translateY(${rowOffset(index)}px)` }}
        >
          <div
            className={`wallet-row ${selected === wallet.name ? "current" : ""}`}
            onClick={() => {
              if (drag) return; // это было перетаскивание, а не тап
              onChoose(wallet.name);
            }}
          >
            <span className="category-icon" style={catIconVars(wallet.bg, wallet.fg)}>
              <CategoryGlyph emoji={wallet.emoji} size={20} />
            </span>
            <span className="cat-name">{wallet.name}</span>
            <span className="wallet-row-total">
              {formatBalance(balanceOf(wallet.name), walletCurrency(wallet.name))}
            </span>
            <button
              className="wallet-edit"
              aria-label="Редактировать"
              onClick={(event) => {
                event.stopPropagation();
                haptic();
                onEdit(wallet);
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15.5 5.5 18.5 8.5 8 19l-4 1 1-4L15.5 5.5Z" />
              </svg>
            </button>
            <span
              className="wallet-drag-handle"
              onTouchStart={(event) => onHandleTouchStart(event, index)}
              aria-label="Перетащить"
              role="button"
            >
              <DragHandle />
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

// «Счета»: pick the wallet the whole main screen is scoped to, add new ones,
// or edit an existing one via the pencil.
export default function WalletsSheet({ balances, pendingWalletDeltas, selected, onSelect, onAdd, onEdit, onClose: onDismiss, onTransfer, onReorder }) {
  const sheetRef = useRef(null);
  const onClose = useSwipeDismiss(sheetRef, onDismiss);

  const groups = walletsByScope();
  // Same formula as accountBalance in App.jsx's "Баланс" row — a wallet with
  // no balance entry (never given a starting amount) has none to show here
  // either, and the pending delta keeps an in-flight add/undo-window delete
  // reflected instantly instead of only after its server round-trip lands.
  const balanceOf = (name) => {
    const entry = balances.find((b) => b.wallet === name);
    return entry ? Number(entry.current_balance) - (pendingWalletDeltas.get(name) || 0) : null;
  };
  // В «Все счета» идут только тенговые счета из групп «Личные» и «Общие»:
  // валюты не складываются, а «Другое» — отдельный карман (см.
  // isInAllAccounts). Каждый счёт всё равно виден своей строкой со своей
  // суммой и своим знаком.
  const homeBalances = balances.filter((b) => isInAllAccounts(b.wallet));
  const allBalance = homeBalances.length
    ? homeBalances.reduce((sum, b) => sum + Number(b.current_balance) - (pendingWalletDeltas.get(b.wallet) || 0), 0)
    : null;
  // Итог группы — по валютам, а не одним числом: тенге складываются с
  // тенге, юани с юанями, и никакого курса тут нет (он вписывается руками
  // ровно в одном месте — в снимке капитала). Поэтому у «Другого», где
  // лежат наличные доллары рядом с тенге, в заголовке стоят обе суммы
  // своими знаками: сложить их нечем, а прятать валютный счёт из итога его
  // же группы — это ровно то расхождение «сумма не сходится со списком
  // под ней», которое здесь уже ловили.
  //
  // Группа определяется флагом счёта (wallets.scope), а не названием: когда
  // это выводили из имени, любой заведённый позже личный счёт молча попадал
  // в общий итог.
  function groupTotals(scope) {
    const totals = new Map();
    for (const entry of balances) {
      if (walletScope(entry.wallet) !== scope) continue;
      const currency = walletCurrency(entry.wallet);
      const value = Number(entry.current_balance) - (pendingWalletDeltas.get(entry.wallet) || 0);
      totals.set(currency, (totals.get(currency) || 0) + value);
    }
    // Тенге первыми — это валюта, в которой ведётся почти всё.
    return [...totals.entries()].sort(([a], [b]) =>
      a === HOME_CURRENCY ? -1 : b === HOME_CURRENCY ? 1 : a.localeCompare(b)
    );
  }
  const formatBalance = (amount, currency = HOME_CURRENCY) =>
    amount != null ? formatMoney(amount, currency, { decimals: true }) : "—";

  function choose(name) {
    haptic();
    onSelect(name);
    onClose();
  }

  return (
    <div className="sheet-backdrop" onClick={withHaptic(onClose)}>
      <div className="categories-sheet" ref={sheetRef} onClick={(event) => event.stopPropagation()}>
        <div className="cats-header">
          <button className="icon-button" onClick={withHaptic(onClose)} aria-label="Закрыть">
            ✕
          </button>
          <span className="cats-title">Счета</span>
          <div className="cats-header-actions">
            <button
              className="icon-button"
              onClick={() => {
                haptic();
                onAdd();
              }}
              aria-label="Новый счёт"
            >
              +
            </button>
            <button
              className="icon-button"
              onClick={() => {
                haptic();
                onTransfer();
              }}
              aria-label="Переводы"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 8h13m-3-3 3 3-3 3M20 16H7m3-3-3 3 3 3" />
              </svg>
            </button>
          </div>
        </div>

        <button
          className={`wallet-row all ${selected === null ? "current" : ""}`}
          onClick={() => choose(null)}
        >
          <span className="cat-name">Все счета</span>
          <span className="wallet-row-total">{formatBalance(allBalance)}</span>
        </button>

        {groups.map((group) => (
          <div className="cats-scope-group" key={group.scope}>
            {/* Заголовок группы стоит НАД её счетами и тем самым отделяет её
                от предыдущей, а заодно несёт итог по ней — у всех трёх
                групп одинаково: раньше сумма была только у общих, и
                «Личные» с «Другим» приходилось складывать глазами.
                Подпись «видно только тебе» уехала отсюда: на её место встал
                итог, а что значит каждая группа, написано там, где счёт
                относят к группе, — в шторке создания/правки счёта. */}
            <div className="wallet-row all wallet-row-summary">
              <span className="cat-name">{GROUP_TITLE[group.scope]}</span>
              <span className="wallet-row-totals">
                {(() => {
                  const totals = groupTotals(group.scope);
                  if (!totals.length) return <span className="wallet-row-total">—</span>;
                  return totals.map(([currency, amount]) => (
                    <span className="wallet-row-total" key={currency}>
                      {formatBalance(amount, currency)}
                    </span>
                  ));
                })()}
              </span>
            </div>

            <WalletGroup
              items={group.items}
              selected={selected}
              balanceOf={balanceOf}
              formatBalance={formatBalance}
              onChoose={choose}
              onEdit={onEdit}
              // Порядок уходит на сервер целиком, включая соседние группы:
              // sort_order сквозной, и присылать только одну группу значило
              // бы перенумеровать её поверх остальных.
              onReorder={(names) => onReorder(group.scope, names)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
