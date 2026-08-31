import { Router } from "express";
import { pool } from "../db.js";
import { getCurrentBalances } from "../services/balanceHistory.js";

export const balanceHistoryRouter = Router();

// Сколько событий отдаём максимум. Остаток мотается НАЗАД от сегодняшнего
// баланса (см. ниже), поэтому окно можно ограничивать свободно — числа в
// нём остаются точными, не надо тянуть всю историю ради первой строки.
const LIMIT = 500;

// «История балансов» — полный журнал движения денег по счетам этого
// аккаунта: и правки опорной суммы (ручные, переводы, долги), и каждая
// трата с доходом.
//
// Траты сюда НЕ дублируются строками при записи, а подмешиваются на чтении.
// Причина та же, по которой баланс вообще не хранится числом (см. db.js над
// wallet_balances): в `expenses` ведёт с десяток путей — ручное добавление,
// голос, скан чека, офлайн-очередь, правка, удаление, отмена удаления, — и
// зеркалящую строку пришлось бы писать (и откатывать при правке/удалении) в
// каждом из них. Один пропущенный путь = молчаливо кривая история. Сборка на
// чтении по определению совпадает с тем, что реально лежит в таблицах.
//
// Как считается остаток: НАЗАД от текущего баланса, а не вперёд от начала.
// Текущий баланс известен точно (getCurrentBalances), а дальше каждое
// событие говорит, каким остаток был до него — трату прибавляем обратно,
// доход вычитаем, а у правки опорной суммы это просто её old_amount. Так
// окно из последних 500 событий даёт верные остатки без чтения всей истории.
balanceHistoryRouter.get("/", async (req, res) => {
  const wallet = req.query.wallet || null;
  const userId = req.user.id;

  const [balances, adjustments, entries] = await Promise.all([
    getCurrentBalances(pool, userId),
    pool.query(
      `SELECT bh.id, bh.wallet, bh.old_amount, bh.new_amount, bh.reason,
              bh.counterpart_wallet, bh.changed_at, u.name AS changed_by_name
       FROM balance_history bh
       LEFT JOIN users u ON u.id = bh.changed_by
       WHERE bh.changed_by = $1 AND ($2::text IS NULL OR bh.wallet = $2)
       ORDER BY bh.changed_at DESC
       LIMIT $3`,
      [userId, wallet, LIMIT]
    ),
    pool.query(
      `SELECT id, wallet, amount, type, category, description, created_at, logged_at
       FROM expenses
       WHERE user_id = $1 AND ($2::text IS NULL OR wallet = $2)
       ORDER BY logged_at DESC
       LIMIT $3`,
      [userId, wallet, LIMIT]
    ),
  ]);

  const events = [
    ...adjustments.rows.map((r) => ({
      key: `adj-${r.id}`,
      id: r.id,
      kind: "adjustment",
      wallet: r.wallet,
      at: r.changed_at,
      reason: r.reason,
      old_amount: r.old_amount,
      new_amount: r.new_amount,
      counterpart_wallet: r.counterpart_wallet,
      changed_by_name: r.changed_by_name,
    })),
    ...entries.rows.map((r) => ({
      key: `exp-${r.id}`,
      id: r.id,
      kind: r.type === "income" ? "income" : "expense",
      wallet: r.wallet,
      // logged_at, не created_at: баланс двигается в момент ЗАПИСИ, и
      // только в этом порядке промежуточные остатки сходятся. Дата самой
      // траты едет отдельным полем — интерфейс покажет её, если она другая.
      at: r.logged_at,
      amount: r.amount,
      category: r.category,
      description: r.description,
      spent_at: r.created_at,
    })),
  ];

  // Свежие сверху. При совпадении времени правка опорной суммы идёт ПЕРЕД
  // тратой (то есть позже неё по времени): формула баланса вычитает траты
  // строго `logged_at > base_at`, так что трата ровно в момент правки в неё
  // уже свёрнута — а совпадение здесь не экзотика, setBalance сам прижимает
  // такие logged_at к base_at.
  events.sort((a, b) => {
    const diff = new Date(b.at) - new Date(a.at);
    if (diff !== 0) return diff;
    if (a.kind !== b.kind) return a.kind === "adjustment" ? -1 : 1;
    // Совпало и время, и вид — раскладываем по id, чтобы порядок был
    // устойчивым: иначе две записи одной секунды могли меняться местами от
    // запроса к запросу, а вместе с ними прыгал бы и остаток рядом с ними.
    return b.id - a.id;
  });

  const running = new Map(balances.map((b) => [b.wallet, Number(b.current_balance)]));
  for (const event of events.slice(0, LIMIT)) {
    if (event.kind === "adjustment") {
      // Правка опорной суммы — сама себе истина: она записала, каким остаток
      // СТАЛ и каким он БЫЛ, в момент, когда это действительно произошло.
      // Поэтому берём их напрямую, а не отмотанное значение: если те вдруг
      // разойдутся (правка задним числом, дырка в данных), верить надо
      // записи, и заодно она возвращает цепочку на твёрдую землю для всего,
      // что ниже. old_amount = null — самая первая правка счёта: цепочка
      // обрывается, и всё, что старше, честно отдаётся без остатка вместо
      // выдуманного нуля.
      event.balance_after = event.new_amount == null ? null : Number(event.new_amount);
      running.set(event.wallet, event.old_amount == null ? null : Number(event.old_amount));
      continue;
    }
    const after = running.has(event.wallet) ? running.get(event.wallet) : null;
    event.balance_after = after;
    if (after == null) continue;
    // Отматываем назад: трата уменьшила остаток, значит до неё он был больше.
    const delta = event.kind === "income" ? -Number(event.amount) : Number(event.amount);
    running.set(event.wallet, after + delta);
  }

  res.json(events.slice(0, LIMIT));
});
