## Goal
Add a smart backend verification engine that flags duplicate and suspicious trips across all trips in the next 7 days, with inline badges and Dismiss / Merge quick-actions on coordinator cards.

## 1. Backend — flag computation

New server function `computeTripFlags` in `src/lib/coordinator.functions.ts` (auth-scoped to caller's `company_id`).

Input: none — server pulls the caller's window itself.

Scope: all jobs in caller's company with `date` from today through +7 days, excluding `status in ('cancelled','rejected','completed')` and excluding kinds already listed in `jobs.dismissed_flags`.

Rules (per user selection):
- **Potential Duplicate**: same normalized first pax name + same `date` + pickup times within ±60 min. Route match is a bonus signal (raises confidence label) but not required.
- **Suspicious Pattern (Verify Flight Numbers)**: fires when EITHER
  - same pax + same date + ≥2 trips where `from_location` or `to_location` matches `%airport%` / IATA-like tokens (3-letter codes) at times ≥90 min apart, OR
  - same pax + same date + ≥2 trips whose `flight_number` values are both present and differ.

Returns: `Record<jobId, { duplicates: {id, time, route}[]; suspicious: {id, time, flight_number}[] }>` — sibling ids so the UI can render "Merge with…" and "Verify against…".

One batched SQL fetch per company (single `SELECT` over the 7-day window), grouped in memory. ~80-line handler.

## 2. Backend — dismiss + merge actions

Two new server functions:

- `dismissTripFlag({ job_id, kind: "duplicate" | "suspicious" })` — appends the kind to `jobs.dismissed_flags text[]`. Company-scoped.
- `mergeTrips({ keep_job_id, drop_job_ids: string[] })` — coordinator explicitly picks which trip survives. Verifies all rows belong to caller's company, copies any missing pax rows from dropped jobs onto the kept job (dedup by name), then soft-cancels dropped rows (`status='cancelled'`, internal note `merged into <keep_job_id>`). No hard delete.

Requires **one migration**:

```text
ALTER TABLE public.jobs
  ADD COLUMN dismissed_flags text[] NOT NULL DEFAULT '{}';
```

Existing `jobs` RLS covers the column.

## 3. UI — badges + quick actions

Extend two surfaces in `src/routes/_authenticated/coordinator.calendar.tsx`:

- **`PendingClientApprovalBoard`** (the pink/amber draft cards).
- **`UnassignedColumn`** cards for any job in the 7-day window.

Shared behavior:
- One `useQuery(["trip-flags"], computeTripFlags)` at the page level, refetch every 30s and on job list changes.
- For each card whose id has flags, render:
  - `⚠️ Potential Duplicate Trip` badge (destructive) when `duplicates.length > 0`.
  - `🔍 Suspicious Pattern: Verify Flight Numbers` badge (amber) when `suspicious.length > 0`.
  - Compact action row under existing buttons:
    - `Dismiss` (icon-only on small cards) → calls `dismissTripFlag` for the shown kind, refetches.
    - `Merge…` (only when duplicates exist) → opens a small dialog listing this trip + each duplicate sibling (date, time, route, pax); coordinator radio-picks the trip to keep, confirms, and `mergeTrips` runs.
- Badges disappear once dismissed or after merge (cache invalidated for `trip-flags` and `jobs`).
- No change to Approve / Go-Ahead behavior — flags are advisory only.

New tiny component: `src/components/coordinator/MergeTripsDialog.tsx` (single file, ~80 lines).

## 4. Files touched

- `src/lib/coordinator.functions.ts` — add `computeTripFlags`, `dismissTripFlag`, `mergeTrips`.
- `src/routes/_authenticated/coordinator.calendar.tsx` — page-level query + render badges/actions in `PendingClientApprovalBoard` and `UnassignedColumn`.
- `src/components/coordinator/MergeTripsDialog.tsx` — new.
- 1 migration adding `jobs.dismissed_flags`.

## Out of scope

- Cross-company duplicate detection.
- Automatic auto-merge without confirmation.
- Flagging past / completed trips.
- Editing the flag rules from the UI (thresholds are constants; can be exposed later).
