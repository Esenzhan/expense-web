// Shared localStorage cache-first helper for read-only sheets that fetch
// from the API on open (Капитал, Долги, История балансов, Напоминания,
// …). Every one of these paints instantly from the last successful fetch
// — offline included — then refreshes quietly in the background; a failed
// refetch never blanks out data that's already on screen. Tagged with the
// owning account's email so a shared device doesn't flash a different
// account's data.
export function loadCached(key, email) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key));
    return parsed && parsed.owner === email ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export function saveCached(key, email, data) {
  try {
    localStorage.setItem(key, JSON.stringify({ owner: email, data }));
  } catch {
    // storage full/unavailable — fine, just skip caching
  }
}
