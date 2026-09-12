export const DRAFT_CACHE_NAME = "traty-expense-drafts-v1";

const DRAFT_CACHE_PATH = "/__traty-cache/expense-drafts/";
const MAX_DRAFT_AGE_MS = 3 * 24 * 60 * 60 * 1000;

function draftUrl(userId, draftId = "") {
  return `${window.location.origin}${DRAFT_CACHE_PATH}${encodeURIComponent(userId)}/${encodeURIComponent(draftId)}`;
}

function cacheAvailable() {
  return "caches" in window && typeof Response !== "undefined";
}

export async function cacheExpenseDrafts(userId, drafts) {
  if (!userId || !cacheAvailable() || !Array.isArray(drafts)) return;
  const cache = await caches.open(DRAFT_CACHE_NAME);
  await Promise.all(
    drafts
      .filter((draft) => draft?.id != null)
      .map((draft) =>
        cache.put(
          draftUrl(userId, draft.id),
          new Response(JSON.stringify(draft), {
            headers: { "Content-Type": "application/json" },
          })
        )
      )
  );
}

export async function loadCachedExpenseDrafts(userId) {
  if (!userId || !cacheAvailable()) return [];
  try {
    const cache = await caches.open(DRAFT_CACHE_NAME);
    const prefix = draftUrl(userId);
    const requests = await cache.keys();
    const matching = requests.filter((request) => request.url.startsWith(prefix));
    const rows = await Promise.all(
      matching.map(async (request) => {
        try {
          return await (await cache.match(request)).json();
        } catch {
          await cache.delete(request);
          return null;
        }
      })
    );
    const now = Date.now();
    const fresh = [];
    await Promise.all(
      rows.map(async (draft) => {
        if (!draft?.id) return;
        const createdAt = new Date(draft.created_at).getTime();
        if (Number.isFinite(createdAt) && now - createdAt > MAX_DRAFT_AGE_MS) {
          await cache.delete(draftUrl(userId, draft.id));
          return;
        }
        fresh.push(draft);
      })
    );
    return fresh.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  } catch {
    return [];
  }
}

export async function removeCachedExpenseDraft(userId, draftId) {
  if (!userId || draftId == null || !cacheAvailable()) return;
  try {
    const cache = await caches.open(DRAFT_CACHE_NAME);
    await cache.delete(draftUrl(userId, draftId));
  } catch {
    // The handled-id list still prevents a dismissed draft from reopening.
  }
}
