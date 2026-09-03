// Local queue for expenses added while offline. Manual add (no mic — voice
// needs the network anyway for STT/parsing) must still work with no
// connection: we keep the payload in localStorage and hand back an object
// shaped like a server expense row so the rest of the app (list, summary,
// wallet totals) can treat it like any other expense, modulo the `pending`
// flag used to show a small sync badge.
const QUEUE_KEY = "traty-pending-expenses";
// Записи, которые сервер отклонил насовсем (см. isPermanentRejection). Лежат
// отдельно от очереди: очередь отправляет по одной и по порядку, и такая
// запись держала бы за собой всё, что добавлено после неё, — а пройти сама
// уже не может. Показываются в настройках, откуда их удаляют руками.
const REJECTED_KEY = "traty-rejected-expenses";

function loadQueue() {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY)) || [];
  } catch {
    return [];
  }
}

function saveQueue(list) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(list));
  } catch {
    // storage full/unavailable — the expense still lives in React state
    // for this session, it just won't survive a reload
  }
}

function loadRejected() {
  try {
    return JSON.parse(localStorage.getItem(REJECTED_KEY)) || [];
  } catch {
    return [];
  }
}

function saveRejected(list) {
  try {
    localStorage.setItem(REJECTED_KEY, JSON.stringify(list));
  } catch {
    // storage full/unavailable — nothing better to do than drop it
  }
}

function toExpenseShape(entry) {
  return {
    id: entry.localId,
    amount: entry.payload.amount,
    category: entry.payload.category,
    wallet: entry.payload.wallet,
    description: entry.payload.description,
    type: entry.payload.type || "expense",
    created_at: entry.createdAt,
    pending: true,
  };
}

// Rows whose POST already succeeded (so the server has them for real) but
// that haven't yet been confirmed present in a fresh /api/expenses fetch —
// held here, shaped like a normal (non-pending) server row real id and all,
// so mergeAndSet keeps showing them across the gap between "popped from the
// local queue" and "the next refreshAll's GET actually reflects them".
// Without this, that gap reads as the just-saved expense vanishing for the
// round-trip and then popping back in once the fetch lands.
let syncedShadow = [];

export function listPendingExpenses() {
  return [...syncedShadow, ...loadQueue().map(toExpenseShape)];
}

// Called once a refreshAll fetch that started after a row's sync has
// landed — a GET issued after the POST resolved is guaranteed to reflect
// it, so it's now safe to stop standing in for it.
export function clearConfirmedSynced(startedAfter) {
  syncedShadow = syncedShadow.filter((e) => e.syncedAt >= startedAfter);
}

export function enqueueExpense(payload) {
  const queue = loadQueue();
  const entry = {
    localId: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    payload,
    // A backdated expense (custom created_at from the date picker) must
    // show up under its own day/period locally too, not just after the
    // server round-trip confirms it.
    createdAt: payload.created_at || new Date().toISOString(),
  };
  queue.unshift(entry); // newest first, matching the server's expense order
  saveQueue(queue);
  return toExpenseShape(entry);
}

export function updatePendingExpense(localId, payload) {
  const queue = loadQueue();
  const index = queue.findIndex((e) => e.localId === localId);
  if (index === -1) return null;
  const entry = { ...queue[index], payload };
  // Mirrors enqueueExpense: a picked created_at must move the row's local
  // date/grouping too, not just what eventually gets POSTed once online.
  if (payload.created_at) entry.createdAt = payload.created_at;
  queue[index] = entry;
  saveQueue(queue);
  return toExpenseShape(queue[index]);
}

export function removePendingExpense(localId) {
  saveQueue(loadQueue().filter((e) => e.localId !== localId));
}

export function hasPendingExpenses() {
  return loadQueue().length > 0;
}

// Отложенные записи для экрана настроек: что пытались сохранить, почему
// сервер отказал и когда. Сумма/счёт/категория лежат в payload — ровно то,
// что ушло бы на сервер, чтобы человек мог решить, вносить ли это заново.
export function listRejectedExpenses() {
  return loadRejected();
}

export function removeRejectedExpense(localId) {
  saveRejected(loadRejected().filter((e) => e.localId !== localId));
}

// Подписка на «запись отложена». Нужна, чтобы приложение сказало об этом
// вслух в тот же момент: отложенная запись исчезает из списка трат (её на
// сервере так и нет), и без баннера это выглядело бы как молча пропавшая
// трата. Слушателя ставит App.jsx — один на всё приложение, поэтому
// сообщение появится независимо от того, кто запустил синхронизацию:
// фоновый опрос, возврат в приложение или сама шторка сразу после
// сохранения.
let rejectionListeners = [];

export function onExpenseRejected(listener) {
  rejectionListeners.push(listener);
  return () => {
    rejectionListeners = rejectionListeners.filter((l) => l !== listener);
  };
}

function notifyRejected(entry) {
  for (const listener of rejectionListeners) {
    try {
      listener(entry);
    } catch {
      // слушатель не должен уметь уронить синхронизацию
    }
  }
}

// Отказ, который сам не пройдёт: сервер понял запрос и ответил «нет» —
// счёт удалили, на счёте не осталось категорий, сумма не проходит
// проверку. Такую запись надо убирать из очереди, иначе она блокирует
// всё, что за ней.
//
// Исключения — отказы, которые пройдут сами: 401 (сессия протухла, после
// входа запись уйдёт), 408 и 429 (сервер просит подождать). Всё, что вообще
// без кода — сеть, спящий Render, обрыв — сюда не попадает: у такой ошибки
// нет `status`, и очередь по-прежнему просто ждёт следующей попытки.
function isPermanentRejection(err) {
  const status = err?.status;
  if (typeof status !== "number") return false;
  return status >= 400 && status < 500 && status !== 401 && status !== 408 && status !== 429;
}

// Flushes the queue through the real API, oldest first. Stops at the first
// failure that could still succeed later (offline, server asleep) so order
// is preserved; a permanent rejection is set aside instead (see
// isPermanentRejection) and the queue moves on. Returns whether the queue
// changed at all, so the caller knows to refresh — a set-aside row leaves
// the list and the totals just like a synced one does.
//
// Guarded against concurrent calls: App.jsx fires this from four independent
// triggers (mount, the `online` event, visibilitychange, and a 15s poll)
// with no coordination between them. A single `createExpense` can take tens
// of seconds on a cold Render instance, so two triggers easily overlap —
// without this flag they'd both read the same queue snapshot and both POST
// the same oldest entry, creating it twice on the server.
let syncing = false;

export async function syncPendingExpenses(createExpense) {
  if (syncing) return false;
  syncing = true;
  try {
    let changed = false;
    while (true) {
      // Re-read fresh on every iteration instead of looping over one
      // snapshot taken at the top: createExpense can take tens of seconds
      // on a cold Render instance, and enqueueExpense() writes straight to
      // localStorage — an entry added while an earlier one is still in
      // flight would otherwise only ever exist in that stale in-memory
      // array, and saving it back after the pop below would silently wipe
      // the newer entry out of localStorage without ever having sent it.
      const queue = loadQueue();
      const entry = queue[queue.length - 1]; // oldest is at the end (unshift adds to front)
      if (!entry) break;
      let created;
      try {
        // localId doubles as the server-side dedup key — if this exact
        // create already landed once (its response just never made it
        // back, e.g. a cold Render start dropping the connection), the
        // retry below returns that original row instead of a new one.
        created = await createExpense({ ...entry.payload, idempotencyKey: entry.localId });
      } catch (err) {
        if (!isPermanentRejection(err)) break;
        // Не пройдёт никогда — откладываем в сторону и идём дальше, иначе
        // за этой записью встанет вся очередь. Причина сохраняется вместе с
        // ней: в настройках человек увидит, что именно не сохранилось.
        saveQueue(loadQueue().filter((e) => e.localId !== entry.localId));
        const rejected = {
          ...entry,
          error: err.message || "Сервер отклонил запись",
          rejectedAt: new Date().toISOString(),
        };
        saveRejected([...loadRejected(), rejected]);
        notifyRejected(rejected);
        changed = true;
        continue;
      }
      // Read fresh again before removing, for the same reason — anything
      // enqueued during the await above must survive this save.
      saveQueue(loadQueue().filter((e) => e.localId !== entry.localId));
      syncedShadow.push({ ...created, pending: false, syncedAt: Date.now() });
      changed = true;
    }
    return changed;
  } finally {
    syncing = false;
  }
}
