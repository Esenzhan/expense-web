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
    created_at: entry.createdAt,
    pending: true,
  };
}

export function listPendingExpenses() {
  return loadQueue().map(toExpenseShape);
}

export function enqueueExpense(payload) {
  const queue = loadQueue();
  const entry = {
    localId: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    payload,
    createdAt: new Date().toISOString(),
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

// Flushes the queue through the real API, oldest first. Stops at the first
// failure (still offline, or server still asleep) so order is preserved —
// returns whether anything actually synced, so the caller knows to refresh.
export async function syncPendingExpenses(createExpense) {
  const queue = loadQueue();
  let syncedAny = false;
  while (queue.length > 0) {
    const entry = queue[queue.length - 1]; // oldest is at the end (unshift adds to front)
    try {
      await createExpense(entry.payload);
    } catch {
      break;
    }
    queue.pop();
    saveQueue(queue);
    syncedAny = true;
  }
  return syncedAny;
}
