## Company Portal Links — unified tab + branded subdomain URLs

Add a **Companies** tab to `/coordinator/portal-links` that owns the full lifecycle of hotel/agent/corporate portals, and switch the public URL from a raw token to a branded subdomain like `grand-hotel.thecoordinator.org`.

### 1. Branded subdomain URLs

- Add `slug` (citext, unique, 3–40 chars, `^[a-z0-9][a-z0-9-]*[a-z0-9]$`) to `portal_companies`. Reserved words blocked (`www`, `admin`, `api`, `app`, `id-preview`, `project`, `mail`, `auth`, `preview`).
- Coordinator sets slug on create (auto-suggested from company name, editable). Rename allowed later with confirm ("old URL stops working").
- Resolver order in `src/routes/portal.$token.tsx` and all `/api/public/portal/$token/*` routes:
  1. If host is `<slug>.thecoordinator.org` (or `*.lovable.app` preview), look up by slug + verify `magic_token` still matches the path param OR accept slug alone when path param is `-`.
  2. Fallback: existing `magic_token` lookup (keeps old links working).
- New route file `src/routes/portal.tsx` (host-based landing) that reads `window.location.hostname`, extracts the slug, and renders the existing portal UI. Raw `/portal/$token` stays as a working fallback for share links + local dev.
- Add a **new server function** `getPortalBySlug` for SSR loader; keep token-based fetch for the fallback path.
- Docs note in the UI: to activate branded subdomains, coordinator must add a wildcard DNS `CNAME *.thecoordinator.org → thecoordinator.org` and enable wildcard SSL on the custom domain (one-time). Until then, links fall back to the raw `/portal/<token>` URL — we still show the pretty form so nothing breaks.

### 2. New "Companies" tab in Portal Links

Refactor `src/routes/_authenticated/coordinator.portal-links.tsx`:

```
Tabs: [ Drivers ] [ Clients ] [ Companies ]
```

The Companies tab replaces the standalone `/coordinator/portals` page (we redirect the old route to the new tab). It shows:

**Create row** (inline card, matches Drivers/Clients styling):
- Name, Kind (hotel/agent/corporate), Slug (auto-suggested, editable, live availability check), Points per booking, Logo upload, Expiry preset, Create.

**Table of companies** (same visual language as the driver/client tables):
| Company | Branded URL | Status | Expires | Actions |

Per-row actions (icon buttons, matching existing pattern):
- **Copy** branded URL
- **WhatsApp share** (reuses existing `shareOnWhatsApp` pattern with a company-specific preview)
- **Toggle ON/OFF** (dormant/revive) — instant, no confirm
- **Extend expiry** — same prompt-based flow as driver/client links, with presets 1h / 24h / 7d / 30d / never
- **Rotate token** — confirm dialog, generates new `magic_token`, keeps slug
- **Upload/replace logo** — opens file picker, uploads to `portal-logos` bucket, updates `logo_url`
- **Manage →** deep-links to `/coordinator/portals/$id` for inbox, statements, change requests (unchanged)
- **Delete** — confirm

Status badge shows: `Live` (green), `Dormant` (grey, link OFF), `Expired` (red), `Rotated` (amber, first 60s).

### 3. UI cleanup on Portal Links page

- Convert the current dense form into the same 3-column responsive card layout used elsewhere.
- Add a small "How links work" helper card at the top of each tab (2 lines).
- Move URL cell to a single-line pill with copy icon (like current Drivers tab).
- Show relative expiry (`in 6 days`) + absolute timestamp on hover.
- Empty states: friendly one-liner + primary CTA button.
- Retire the standalone `/coordinator/portals` list; keep `/coordinator/portals/$id` as the detail page and add a "← Back to Portal Links" breadcrumb.

### 4. Server functions to add in `src/lib/portal.functions.ts`

- `checkSlugAvailable({ slug, excludeId? })`
- `updatePortalSlug({ id, slug })`
- `uploadPortalLogo({ id, path })` (client uploads to `portal-logos/<companyId>/logo.png` via signed URL, then this fn updates `logo_url`)
- `getPortalPreview({ id })` for WhatsApp share text (mirrors driver preview)
- Extend existing `updatePortal` to accept `link_enabled`, `link_expires_at`, `points_per_booking`.

### 5. Migration

```sql
ALTER TABLE public.portal_companies
  ADD COLUMN slug citext UNIQUE
    CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$');
CREATE INDEX portal_companies_slug_idx ON public.portal_companies (slug);
-- Backfill existing rows from name (slugified, dedup with -2, -3…)
```

### Out of scope
- Wildcard DNS/SSL setup itself (documented for coordinator).
- Hotel-side slug editing (coordinator-only per your answer).
- Native/mobile changes.

### Open questions worth confirming before I build
1. Should the raw `/portal/<token>` URL keep working forever as a fallback, or should we auto-redirect to the branded subdomain when the request hits our apex?
2. For the WhatsApp preview: OK to include company logo emoji + upcoming pending-bookings count, or keep it minimal (just link)?
