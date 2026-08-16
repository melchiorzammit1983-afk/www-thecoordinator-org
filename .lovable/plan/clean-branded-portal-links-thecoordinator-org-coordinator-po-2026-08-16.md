# Clean branded portal links: thecoordinator.org/coordinator/portal

## What changes for you

- The create form's **Company name** field becomes **Portal name** — it's the label of the portal and the second part of the link.
- The **Branded link** field no longer shows `/h/` or a long random suffix. It shows your own coordinator name (fixed, auto-derived, not editable) plus an editable portal segment:

```text
thecoordinator.org/ baygorcab / grand-hotel
                    (fixed)     (editable)
```

- Availability checking stays live ("✓ Available" / "already taken"), now scoped to your own coordinator name, so two different coordinators can each have `/…/grand-hotel`.
- **Require client password** stays a per-portal switch. Because clean URLs are guessable, the form shows a short inline note recommending the password for portals that shouldn't be publicly openable.
- Existing `/h/<old-slug>` links keep working — nothing already shared breaks.

## Technical plan

### Database (one migration)

1. `companies.slug citext unique` — the coordinator segment. Backfill from `name` (lowercase, hyphenated, deduped with a numeric suffix), set `not null` after backfill, and keep it stable once set.
2. `portal_companies.portal_slug citext` — the portal segment, generated from the portal name; unique per `(coordinator_company_id, portal_slug)`. Backfill from the existing `slug` with the trailing 16-hex suffix stripped, deduped per coordinator.
3. Keep the existing global-unique `portal_companies.slug` column and its data untouched so legacy `/h/<slug>` links still resolve.

### Server (`src/lib/portal.functions.ts`)

- `getPortalCompanySetup` also returns `coordinator_slug`.
- Replace `professionalPortalSlug` with `portalNameSlug(portalName)` — plain slugify, 3–40 chars, no random suffix.
- `checkSlugAvailable` validates the portal segment against the reserved list and checks uniqueness within the caller's coordinator only.
- `createPortal` / `updatePortal` accept `portal_slug`, validate + dedupe per coordinator, and still write a legacy global `slug` (portal slug + random suffix) so both URL shapes resolve.
- Reserved first-segment guard: the coordinator slug generator and portal slug validator both reject app paths (`api`, `portal`, `track`, `help`, `auth`, `admin`, `install`, `demo`, `b`, `c`, `g`, `h`, `t`, `m`, `crew-portal`, `operation-link`, `sitemap.xml`, `www`, …).

### Routing

- New server route `src/routes/api/public/portal/by-path/$company/$portal.ts` — resolves the pair to the portal's magic token and 302s to `/portal/<token>`, with the same "no longer active" generic 404 and `no-store` headers as the existing by-slug route. The magic token is never in a response body.
- New client route `src/routes/$company/$portal.index.tsx` (`ssr: false`, `noindex`) that redirects to that endpoint, mirroring `h.$slug.index.tsx`.
- Existing `/h/$slug` routes and the by-slug endpoint stay exactly as they are.

### UI (`src/routes/_authenticated/coordinator.portal-links.tsx`)

- Rename the field to **Portal name**; the branded-link control renders the fixed coordinator segment as muted static text and only the portal segment as an input.
- `brandedUrl` / `brandedUrlDisplay` build `https://<host>/<coordinator_slug>/<portal_slug>`, falling back to the legacy `/h/<slug>` form for rows that have no `portal_slug`.
- Table column header "Branded URL" shows the new clean URL; copy/open actions use it.
- Inline hint under the password switch explaining that a clean URL is guessable.

### Verification

- Create a portal in the preview, copy the link, and load it headlessly to confirm it lands on the portal page (and on the password gate when the switch is on).
- Confirm an existing `/h/<old-slug>` link still redirects.
