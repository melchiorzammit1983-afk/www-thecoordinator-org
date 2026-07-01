
## Coordinator Statement / Report Builder

A new page under the coordinator sidebar — **Statements** (`/coordinator/statements`) — where the coordinator builds a detailed trip statement, filters the data, picks which columns to include, previews it in-page, and exports it as CSV or XLSX (and prints to PDF via the browser).

### 1. Data scope

One row per trip (job) visible to the coordinator's company (own jobs + jobs where their company is anywhere in the dispatch chain, respecting existing RLS). Optional expansions:

- **Per-passenger rows** (one row per pax on the trip) — toggle.
- **Include dispatch chain hops** as an extra sub-table under each trip in the preview, and as an extra `Chain` column (A → B → C with status/timestamps) in the flat export.

### 2. Filters (all optional, combinable)

- Date range (pickup date, from / to)
- Status (multi-select: pending, assigned, accepted, en_route, arrived, in_progress, completed, cancelled)
- Payment status (paid / pending / unpaid)
- Company scope: own only / include partner (chain) trips / specific partner company (multi-select from connections)
- Driver (multi-select, incl. "me" and partner virtual drivers) + "Unassigned"
- Label (multi-select from trip_labels)
- Flight number (text, contains)
- Flight status (on-time / delayed / cancelled / any)
- From / To location (text, contains)
- Passenger name (text, contains — matches pax.name/surname)
- Room number (text)
- Free-text search (name, flight, from, to, room, notes)
- Has unread chat messages (yes/no)
- Deletion-requested only (yes/no)

Filter state lives in the URL via `validateSearch` so statements are shareable/reloadable.

### 3. Column picker

Checkbox list, grouped, with a "Select all / Reset to defaults" control. Ordering via drag handles.

- **Trip**: Date, Pickup time, Status, Payment status, Label(s), Notes, Created at
- **Route**: From, To, Flight number, Flight status, Airline, Scheduled dep/arr, Actual dep/arr
- **People**: Driver name, Driver phone, Driver vehicle, Passenger count, Passenger names, Room numbers
- **Chain**: Origin company, Executor company, Full chain (A → B → C), Hop count, Dispatch status
- **Ops**: Accepted at, En route at, Arrived at, Completed at, Deletion requested at
- **Costs**: Points charged for this trip (from points_ledger)

Defaults: Date, Pickup time, From, To, Flight, Driver, Pax count, Status, Payment status.

### 4. Preview + export

- Live preview table (sticky header, virtualized if >200 rows) with the selected columns and filters applied.
- Header shows: company name, generated-at timestamp, active filters as chips, row count, totals row (trips, pax, points).
- Actions: **Export CSV**, **Export XLSX**, **Print / Save PDF** (uses browser print with a print-only stylesheet), **Copy link** (URL with filters).
- File name pattern: `statement_{companyslug}_{yyyy-mm-dd}_{yyyy-mm-dd}.csv`.

### 5. Sidebar entry

Add **Statements** (icon: `FileText`) between "Labels" and "Collaborate" in `src/routes/_authenticated/coordinator.tsx` NAV.

### Technical details

- New route: `src/routes/_authenticated/coordinator.statements.tsx` with `validateSearch` (zod) for all filter fields + selected columns array + row-mode (`trip` | `pax`).
- New server fn `buildStatement` in `src/lib/coordinator.functions.ts`:
  - `.middleware([requireSupabaseAuth])`, input = filter object + `rowMode` + `includeChain`.
  - Resolves caller company via existing `resolveCompany`.
  - Queries `jobs` with the same RLS the coordinator already has (own + chain via existing policies), joins `drivers`, `job_labels → trip_labels`, `pax`, `job_dispatch_hops`, `companies` (for origin/executor/chain names via `supabaseAdmin` for name lookup only, matching the pattern already used in `listConnections`), and `points_ledger` (sum per job).
  - Applies filters server-side; returns plain DTO array (SSR-safe).
  - Hard cap 5000 rows; response includes `truncated: boolean`.
- Client: TanStack Query `queryKey: ["statement", filters]`; preview uses `useSuspenseQuery`.
- CSV export: build string in-browser from DTO, `Blob` + `<a download>`.
- XLSX export: add `xlsx` (SheetJS `xlsx` package, pure-JS, Worker-safe) via `bun add xlsx`; build workbook client-side.
- PDF: no dependency — dedicated `@media print` block hides sidebar/header, prints preview only.
- Column picker persists last selection in `localStorage` under `statement:columns:v1`.
- No schema changes required. No new tables, no migrations.

```text
Sidebar → Statements
┌─ Filters (collapsible) ────────────────┐  ┌─ Columns ─────────┐
│ Date  Status  Payment  Company  Driver │  │ ☑ Date            │
│ Label Flight  From     To       Pax    │  │ ☑ Time  ⋮         │
│ Search…                                │  │ ☑ From  ⋮         │
└────────────────────────────────────────┘  │ ☐ Chain           │
[ Reset ] [ Copy link ]  Rows: 128         └───────────────────┘
[ Export CSV ] [ Export XLSX ] [ Print / PDF ]
─── Preview ───────────────────────────────────────────────────
| Date | Time | From | To | Flight | Driver | Pax | Status |
```

### Out of scope (call out, not building)

- Scheduled/emailed statements.
- Aggregations beyond totals row (charts, per-driver summaries) — can follow later.
- Editing trips from the statement view — read-only.
