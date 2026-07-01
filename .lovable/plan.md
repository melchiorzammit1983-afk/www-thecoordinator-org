## Goal
Fix connection names showing "Unknown", let connected partners act as assignable "drivers" on the dispatch board, and let the coordinator themself be assigned to trips with the same status controls a driver has.

## 1. Connection names ("Unknown" bug)
`listConnections` in `src/lib/collab.functions.ts` currently returns `other: null` (or the join fails under RLS) so the Collaborate page renders "Unknown".

- Rewrite `listConnections` to load the connection rows, then fetch the other company's `id, name` in a second query via `supabaseAdmin` (loaded inside the handler) so RLS on `companies` doesn't hide the partner's name.
- Return `{ ...conn, other: { id, name }, i_am_owner }`.

## 2. Partners as assignable "drivers" on the dispatch board
Today only rows in `public.drivers` show up in the assign menu and driver dropdowns. We'll treat active connections as virtual dispatch targets without polluting the `drivers` table.

- New server fn `listAssignableTargets` in `coordinator.functions.ts` returning a merged list:
  - `{ kind: "driver", id, name, seats, availability }` — existing drivers
  - `{ kind: "partner", id: companyId, name }` — every active connection partner
  - `{ kind: "self", id: myCompanyId, name: "Me (<company>)" }` — the current coordinator (see §3)
- Update the assign UI in `coordinator.calendar.tsx` (TripCard ⋮ → "Move to…") and `JobFormDialog.tsx` driver picker to consume this list. Selecting a partner calls the existing `dispatch_job_forward` RPC (1 point). Selecting a driver keeps current behavior. Selecting "self" uses a new path (see §3).
- `TripCard` label logic already reads `driver_id`; extend it to also show the partner/self name when `executor_company_id !== origin` or when `self_assigned_user_id` is set.

## 3. Coordinator self-assignment + status updates
So a coordinator can run a trip themselves and mark en_route / arrived / in_progress / completed like a driver does.

- Migration: add `jobs.self_assigned_user_id uuid` (nullable, references `auth.users`). No trigger changes; existing `driver_id` stays null when self-assigned.
- New server fns (auth-gated, company-scoped):
  - `assignSelf({ jobId })` — sets `self_assigned_user_id = auth.uid()` on jobs the caller's company executes; clears `driver_id`.
  - `unassignSelf({ jobId })`.
  - `updateSelfJobStatus({ jobId, status })` — mirrors the driver status transitions and writes a `driver_status_updates` row (actor = user).
- Dispatch board: when `self_assigned_user_id` is set, TripCard shows a "You" badge and a new inline status control (same options the driver portal uses: en_route → arrived → in_progress → completed). Card colouring uses the same green/amber rules as driver acceptance (self-assign counts as accepted).
- No new mobile route needed — the coordinator updates status from the dispatch card itself. (The existing driver portal is untouched.)

## 4. Small UI touches
- Collaborate page: keep the current layout; only the "Unknown" text changes.
- Calendar assign menu: group entries with a header (Drivers / Partners / Me).
- Chat and chain timeline already work per-job, so no changes there.

## Technical notes
- Points: only partner dispatch charges (existing `dispatch_job_forward`). Self and driver assignment cost 0.
- RLS: `self_assigned_user_id` column is covered by existing `jobs` policies (company owner / chain member). No new policy needed.
- Realtime: `jobs` is already in `supabase_realtime`, so status changes propagate to all hops.

## Files touched
- `supabase` migration: add `jobs.self_assigned_user_id`.
- `src/lib/collab.functions.ts` — fix `listConnections`.
- `src/lib/coordinator.functions.ts` — add `listAssignableTargets`, `assignSelf`, `unassignSelf`, `updateSelfJobStatus`.
- `src/routes/_authenticated/coordinator.calendar.tsx` — merged assign menu, self status control, badges.
- `src/components/coordinator/JobFormDialog.tsx` — merged driver/partner/self picker.
