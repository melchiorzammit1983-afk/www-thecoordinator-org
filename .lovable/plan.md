# Switch branded portal URLs to path slugs

You picked "Drop subdomains, use path slugs." That means branded links become:

```
https://thecoordinator.org/h/grand-hotel
https://thecoordinator.org/h/hilton-downtown
```

No DNS changes, no SSL provisioning, no wildcard setup. Works the moment we ship. The existing `slug` column and Companies tab stay — only the URL shape and resolver change.

## What you'll need to do
Nothing. Your domain is already connected. Once this ships, every branded link is live.

## What I'll change in code

### 1. New route: `/h/$slug`
Create `src/routes/h.$slug.tsx`. On load:
- SSR loader calls `getPortalBySlug({ slug })` (already exists).
- If found + link enabled + not expired → render the portal (reuse the exact component body from `portal.$token.tsx`, or redirect to `/portal/{token}` internally).
- If not found → 404 with a friendly "This link is no longer active" page.
- If dormant/expired → same friendly page with the hotel's logo + name.

### 2. Update the Companies tab (`coordinator.portal-links.tsx`)
- Every place that currently builds `https://{slug}.thecoordinator.org` changes to `https://thecoordinator.org/h/{slug}`.
- Copy button, WhatsApp share, and the URL pill all use the new format.
- Live availability check (`checkSlugAvailable`) keeps working as-is — slug uniqueness still matters.

### 3. Retire the subdomain resolver
- Delete `src/routes/portal.index.tsx` (the hostname-sniffing landing page — no longer needed).
- Keep `src/routes/api/public/portal/by-slug/$slug.ts` — the new `/h/$slug` route uses it.
- `/portal/$token` keeps working as a fallback for any already-shared raw links.

### 4. Reserved slugs
Keep the existing reserved-slug list (`www`, `api`, `admin`, `auth`, `app`, etc.) so `/h/api` etc. can never be claimed.

### 5. Slug rules (unchanged from what's already in the DB)
- lowercase, a–z, 0–9, hyphens
- 3–40 chars
- unique across all portals
- auto-suggested from company name, coordinator can edit before creating

## URL examples after this ships
| Company | Branded link |
|---|---|
| Grand Hotel Dubai | `thecoordinator.org/h/grand-hotel-dubai` |
| Hilton Downtown | `thecoordinator.org/h/hilton-downtown` |
| Marriott JBR | `thecoordinator.org/h/marriott-jbr` |

Every link looks professional, is short enough for WhatsApp, and carries the hotel's own name.

## Files touched
- **Create**: `src/routes/h.$slug.tsx`
- **Edit**: `src/routes/_authenticated/coordinator.portal-links.tsx` (URL format only)
- **Delete**: `src/routes/portal.index.tsx`
- **Keep unchanged**: DB migration, `by-slug` API, `/portal/$token` fallback, all server functions

No database migration needed — the `slug` column and constraints from the previous turn stay exactly as they are.
