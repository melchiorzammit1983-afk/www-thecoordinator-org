// Tiny localStorage cache for the client trip portal (offline mode).

const KEY_PREFIX = "cc.portal.cache.";

export type PortalCacheEntry = {
  at: number;
  data: unknown;
};

export function readPortalCache(token: string): PortalCacheEntry | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY_PREFIX + token);
    if (!raw) return null;
    return JSON.parse(raw) as PortalCacheEntry;
  } catch {
    return null;
  }
}

export function writePortalCache(token: string, data: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      KEY_PREFIX + token,
      JSON.stringify({ at: Date.now(), data } satisfies PortalCacheEntry),
    );
  } catch {
    /* quota exceeded — ignore */
  }
}
