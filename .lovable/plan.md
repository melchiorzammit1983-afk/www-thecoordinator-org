# Board Creator + Multi-Logo Billing

## 1. Database migration

**`company-logos` storage bucket** (public, RLS on `storage.objects`):
- Path convention: `{company_id}/{uuid}.{ext}`.
- Coordinators can INSERT/UPDATE/DELETE only under their own `company_id` folder; everyone can SELECT (bucket is public).

**`company_logos` table**
- `company_id` (fk companies), `storage_path` (text), `public_url` (text), `label` (text, optional), `is_primary` (bool), `sort_order` (int), timestamps.
- RLS: coordinator can CRUD rows for their own company; admin full access.
- Grants: `SELECT, INSERT, UPDATE, DELETE` to `authenticated`; `ALL` to `service_role`.
- Trigger: when a row is deleted, best-effort remove the storage object (via trigger calling a security-definer function).

**`jobs.board_config jsonb`** — nullable column for saved board state.

**`ai_feature_costs` seed row**
- `feature_key = 'extra_company_logos_weekly'`, default `points_cost = 20`, `enabled = true`. Editable from the existing Admin AI & Features Pricing panel with no UI changes.

**Weekly flat overage billing**
- `public.charge_extra_logos_weekly()` (security definer): for every company with `count(company_logos) > 5`, call `spend_points(company_id, 'extra_company_logos_weekly', null, 'weekly extra-logos fee (flat)')` — flat single deduction regardless of overage count. Skips silently on `insufficient_points`.
- Scheduled via `pg_cron`: Monday 03:00 UTC. Cron uses the SQL-only pattern (no HTTP call needed).

## 2. Server functions (`src/lib/coordinator.functions.ts`)

- `listMyLogos()` — returns rows for caller's company.
- `getLogoUploadUrl({ filename, contentType })` — returns a Supabase Storage signed upload URL scoped to `{company_id}/{uuid}.{ext}` (uses `supabaseAdmin` inside the handler after `requireSupabaseAuth`).
- `registerUploadedLogo({ storage_path, label? })` — inserts row with resolved public URL; returns `{ id, total, over_free_limit: bool, weekly_cost: number }`.
- `deleteMyLogo({ id })` — deletes row + storage object.
- `setPrimaryLogo({ id })` — mark one primary.
- `getBoardTripContext({ jobId })` — returns `{ id, name, surname, flight_number, pickup_at, from_location, to_location, board_config, public_tracking_url }` for caller's company.
- `saveTripBoardConfig({ jobId, board_config })` — writes `jobs.board_config`.

All under `requireSupabaseAuth`.

## 3. New route: `src/routes/_authenticated/coordinator.board-creator.tsx`

Path `/coordinator/board-creator`, optional search `?jobId=<uuid>`.

**Left column — Full editor** (`react-rnd` for drag/resize; `qrcode.react` for the QR):
- Canvas 720×1280 (portrait phone). Elements stored as `{ id, type, x, y, w, h, rotation, z, props }`:
  - **Text blocks** (multiple): content, fontFamily (system-safe list), size, weight, color, align, shadow. Default seed when jobId is present: "Welcome" + "NAME SURNAME" + flight/pickup line.
  - **Logo block**: select from uploaded logos, size, position. Toggle to show/hide.
  - **Background image**: upload (goes through the same storage flow, tagged as background so it's not counted against the 5-logo limit) or solid/gradient color.
  - **QR block**: encodes the trip's public tracking URL. Auto-hidden when no jobId.
- Left rail: layers list with reorder, duplicate, delete.
- Top bar: Undo/Redo, Save, Export PNG (via `html-to-image`), "Back to trip".

**Right column — Live preview**
- iPhone-frame device mockup (rounded, notch, shadow) at 375×667 scaled from the canvas. Live re-renders on every edit.

**Persistence**
- `Save` writes `board_config` to `jobs.board_config` when `jobId` present. Auto-save every 5s while dirty.
- Without `jobId`: preview only + "Save as template" button stored per-user in `localStorage` (no schema change).

**Extra-logo banner**
- When `count > 5`: persistent amber alert:
  > "You have {N} logos. 5 are free — one flat weekly fee of {cost} points applies while you have more than 5. Next charge: next Monday."
- Deleting back to ≤5 removes the banner immediately.

## 4. Trip Card quick-action

In `src/routes/_authenticated/coordinator.calendar.tsx` — in the existing `TripCard` action row (next to Merge/Dismiss), add a **"🪧 Create Sign Board"** button that navigates:
```tsx
<Link to="/coordinator/board-creator" search={{ jobId: trip.id }}>Create Sign Board</Link>
```
Same button on the pink `PendingClientApprovalBoard` cards.

## 5. Admin panel

The flat weekly cost is `ai_feature_costs.extra_company_logos_weekly`. It shows up automatically in the existing "AI & Features Pricing" card grid with a 0–50 slider — no admin UI changes needed.

## Packages to add
- `react-rnd` (drag/resize)
- `qrcode.react` (QR)
- `html-to-image` (PNG export)

## Out of scope
- Rendering the saved board inside the driver's mobile app (this ships the coordinator side + persistence; the driver read is a separate task).
- Editing per-logo billing thresholds from the UI (admin panel already handles cost; free-limit `5` is a constant).
- Full font upload; text uses system-safe fonts only in v1.
