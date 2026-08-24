// Local queue for expenses added while offline. Manual add (no mic — voice
// needs the network anyway for STT/parsing) must still work with no
// connection: we keep the payload in localStorage and hand back an object
// shaped like a server expense row so the rest of the app (list, summary,
// wallet totals) can treat it like any other expense, modulo the `pending`
// flag used to show a small sync badge.
const QUEUE_KEY = "traty-pending-expenses";

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
  queue[index] = { ...queue[index], payload };
  saveQueue(queue);
  return toExpenseShape(queue[index]);
}

export function removePendingExpense(localId) {
  saveQueue(loadQueue().filter((e) => e.localId !== localId));
}

export function hasPendingExpenses() {
  return loadQueue().length > 0;
}

// Flushes the queue through the real API, oldest first. Stops at the first
// failure (still offline, or server still asleep) so order is preserved —
// returns whether anything actually synced, so the caller knows to refresh.
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
    let syncedAny = false;
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
      } catch {
        break;
      }
      // Read fresh again before removing, for the same reason — anything
      // enqueued during the await above must survive this save.
      saveQueue(loadQueue().filter((e) => e.localId !== entry.localId));
      syncedShadow.push({ ...created, pending: false, syncedAt: Date.now() });
      syncedAny = true;
    }
    return syncedAny;
  } finally {
    syncing = false;
  }
}
