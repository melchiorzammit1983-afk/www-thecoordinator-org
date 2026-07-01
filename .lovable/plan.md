# Trip labels (colored tags on cards)

Let coordinators create reusable colored labels (e.g. "VIP Crew", "Urgent", "Airport run") and attach one or more to a trip. On the dispatch board each trip card gets a left-edge color stripe plus small named chips.

## Database

New table `trip_labels` (per company):
- `id`, `company_id`, `name`, `color` (hex like `#E11D48`), `sort_order`, timestamps
- Unique `(company_id, lower(name))`
- RLS: coordinator (company owner) can CRUD their own company's labels; admin full access
- GRANTs for `authenticated` + `service_role`

Join table `job_labels`:
- `job_id` → `jobs(id)` on delete cascade
- `label_id` → `trip_labels(id)` on delete cascade
- PK `(job_id, label_id)`
- RLS: same company scope via `jobs.company_id`

No changes to `jobs`.

## Server functions (`src/lib/coordinator.functions.ts`)

- `listLabels()` → labels for current company
- `createLabel({ name, color })`
- `updateLabel({ id, name?, color? })`
- `deleteLabel({ id })`
- `setJobLabels({ job_id, label_ids: string[] })` — replace set for a job
- Extend `listJobs` result to include `labels: { id, name, color }[]` (via a joined select on `job_labels(trip_labels(*))`)
- Extend `createJob` / `updateJob` input with optional `label_ids` and persist through `setJobLabels`
- `createJobsBulk` accepts an optional `label_ids` array applied to every created job

## UI

**Label manager** — new route `src/routes/_authenticated/coordinator.labels.tsx` with a simple table: create/rename/recolor/delete. Color picker = preset swatches (10 tasteful hues) + custom hex input. Linked from the coordinator sidebar.

**Job form** (`src/components/coordinator/JobFormDialog.tsx`) — new "Labels" section (multi-select chips) present on both the single-trip tab and the bulk-paste tab. Includes an inline "+ New label" quick-create that opens a mini popover (name + color) and appends the new label to the selection.

**Trip card** (`src/routes/_authenticated/coordinator.calendar.tsx` → `TripCard`):
- Left-edge vertical color stripe (4 px) using the first label's color; if multiple labels, render a stacked gradient of up to 3 colors
- Small rounded chips under the route line: `● VIP Crew` etc. (dot uses label color, chip background = 10% tint)
- Stripe/chips coexist with existing status border (green/orange/red). Border keeps meaning status; stripe = category.

**Driver portal card** (`src/routes/m.driver.$token.tsx`) — show the same chips (read-only) so drivers see "VIP Crew" too. Extend `getDriverManifest` in `src/lib/coordinator-public.functions.ts` to include labels.

## Out of scope

- Filtering by label (can add later to the search/filters toolbar)
- Per-user color themes or icon per label
- Label analytics
