import { useCallback, useState } from "react";

// Per-browser "favorite/recent routes" for the New Trip dialog — a coordinator
// productivity shortcut, not core business data, so no DB table: it's fine if
// it doesn't sync across devices. Favorites are kept indefinitely; recent
// (non-favorited) routes are capped at 8, most-recent first.

const STORAGE_KEY = "coordinator.recentRoutes.v1";
const MAX_RECENT = 8;

export type SavedRoute = {
  key: string;
  from: string;
  fromPlaceId: string | null;
  fromDisplayName: string | null;
  fromLat: number | null;
  fromLng: number | null;
  to: string;
  toPlaceId: string | null;
  toDisplayName: string | null;
  toLat: number | null;
  toLng: number | null;
  favorite: boolean;
  lastUsedAt: number;
};

function routeKey(from: string, to: string): string {
  return `${from.trim().toLowerCase()}||${to.trim().toLowerCase()}`;
}

function load(): SavedRoute[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function save(routes: SavedRoute[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(routes));
  } catch {
    /* ignore quota errors — this is a convenience feature only */
  }
}

export function useRecentRoutes() {
  const [routes, setRoutes] = useState<SavedRoute[]>(() => load());

  const recordRoute = useCallback(
    (route: Omit<SavedRoute, "key" | "favorite" | "lastUsedAt">) => {
      if (!route.from.trim() || !route.to.trim()) return;
      setRoutes((current) => {
        const key = routeKey(route.from, route.to);
        const existing = current.find((r) => r.key === key);
        const updated: SavedRoute = {
          ...route,
          key,
          favorite: existing?.favorite ?? false,
          lastUsedAt: Date.now(),
        };
        const rest = current.filter((r) => r.key !== key);
        const favorites = rest.filter((r) => r.favorite);
        const nonFavorites = rest.filter((r) => !r.favorite);
        const merged = updated.favorite
          ? [updated, ...favorites, ...nonFavorites.slice(0, MAX_RECENT)]
          : [...favorites, updated, ...nonFavorites].slice(0, favorites.length + MAX_RECENT);
        save(merged);
        return merged;
      });
    },
    [],
  );

  const toggleFavorite = useCallback((key: string) => {
    setRoutes((current) => {
      const next = current
        .map((r) => (r.key === key ? { ...r, favorite: !r.favorite } : r))
        .sort((a, b) => (a.favorite === b.favorite ? b.lastUsedAt - a.lastUsedAt : a.favorite ? -1 : 1));
      save(next);
      return next;
    });
  }, []);

  return { routes, recordRoute, toggleFavorite };
}
