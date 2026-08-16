/**
 * Slug helpers for branded portal links: `/<coordinator-slug>/<portal-slug>`.
 *
 * Pure functions only — safe to import from both client components and
 * server functions.
 */

export const PORTAL_SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

/**
 * First-segment names that belong to the app itself. A coordinator slug can
 * never take one of these, otherwise `/help`, `/portal/...`, `/api/...` etc.
 * would be shadowed by a branded link.
 */
export const RESERVED_SLUGS = new Set([
  "www", "admin", "admin-auth", "api", "app", "assets", "auth", "b", "c", "cdn",
  "crew-portal", "demo", "docs", "g", "h", "help", "id-preview", "install", "m",
  "mail", "operation-link", "portal", "preview", "project", "public", "robots.txt",
  "sitemap.xml", "static", "t", "track", "request-access", "settings", "coordinator",
  "my-tickets", "lovable", "mcp",
]);

export function slugifyWeb(input: string, max = 40): string {
  return (input || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
}

/** Portal segment of the branded link, derived from the portal name. */
export function portalNameSlug(portalName: string): string {
  const base = slugifyWeb(portalName, 40);
  if (!base) return "";
  return base.length >= 3 ? base : `${base}-portal`;
}

/** Coordinator segment, derived from the coordinator company name. */
export function coordinatorNameSlug(companyName: string): string {
  const base = slugifyWeb(companyName, 32);
  if (!base) return "";
  const safe = base.length >= 3 ? base : `${base}-co`;
  return RESERVED_SLUGS.has(safe) ? `${safe}-co` : safe;
}

export function brandedPortalPath(
  coordinatorSlug: string | null | undefined,
  portalSlug: string | null | undefined,
  legacySlug?: string | null,
): string | null {
  if (coordinatorSlug && portalSlug) return `/${coordinatorSlug}/${portalSlug}`;
  if (legacySlug) return `/h/${legacySlug}`;
  return null;
}
