# Batch C — Completed

## Files modified

**New**
- `src/lib/audit.functions.ts` — `listTripAudit`,
  `listSuspiciousActivity`, `approveStopReorder`.
- `src/lib/groups.functions.ts` — `listGroupStops`, `reorderStops`,
  `splitGroup`, `mergeGroups`, `requestStopReorder`.
- `src/components/coordinator/TripAuditTimeline.tsx`
- `src/components/coordinator/SuspiciousActivityCard.tsx`
- `src/components/coordinator/GroupStopsPanel.tsx`
- `docs/BATCH_C_IMPLEMENTATION_PLAN.md`
- `docs/BATCH_C_COMPLETED.md`
- `docs/BATCH_C_MANUAL_TESTING.md`

**Modified**
- `src/routes/_authenticated/coordinator.index.tsx` — mounts
  `SuspiciousActivityCard`.
- `src/components/coordinator/TripDetailsSheet.tsx` — mounts
  `GroupStopsPanel` (when `group_id`) and always mounts
  `TripAuditTimeline`.
- `src/routes/m.driver.$token.tsx` — driver **🔀 Reorder stops**
  button + `DriverStopReorderButton` component.
- `src/lib/coordinator-public.functions.ts` — appended
  `listGroupStopsForDriver` and `requestStopReorderByDriver`
  (driver-token endpoints).

## Database changes

Migration `Batch C — Audit Trail, Anti-Tampering, Grouped Trip Stops`:

- Tables: `trip_audit_log`, `group_stops`,
  `group_stop_reorder_requests`.
- Functions: `canonical_jsonb`, `record_trip_audit`,
  `verify_trip_audit_chain`.
- View: `v_suspicious_activity`.
- Triggers: `trg_audit_jobs_status`, `trg_audit_wait_sessions`,
  `trg_audit_boarding_approvals`, `trg_audit_emergency_overrides`,
  `trg_audit_pax`.
- Grants: `SELECT`+`INSERT` on `trip_audit_log` to authenticated
  (INSERT blocked by `WITH CHECK (false)`); ALL to service_role;
  `EXECUTE` on `record_trip_audit` and `verify_trip_audit_chain`
  restricted to authenticated + service_role (revoked from anon/public).
- RLS: coordinators read `trip_audit_log` scoped to `company_id =
  private.company_of(auth.uid())`; admins read all. `group_stops`
  and `group_stop_reorder_requests` scoped via parent group's job
  company.

## API changes

- `audit.functions.ts` — `listTripAudit`, `listSuspiciousActivity`,
  `approveStopReorder`.
- `groups.functions.ts` — `listGroupStops`, `reorderStops`,
  `splitGroup`, `mergeGroups`, `requestStopReorder`.
- `coordinator-public.functions.ts` — `listGroupStopsForDriver`,
  `requestStopReorderByDriver`.

## Audit architecture

Every audit row is written by `record_trip_audit` inside a
`SECURITY DEFINER` function that:

1. Resolves `company_id` and `driver_id` from the source job.
2. Locks the previous row for the trip (`FOR UPDATE`) to serialize the
   chain.
3. Canonicalizes the full payload (including `company_id` and
   `approval_status`) with `canonical_jsonb`.
4. Computes `row_hash = sha256(prev_hash || canonical)` via `pgcrypto`.
5. Inserts the row with `server_time = now()`; the caller-supplied
   `device_time` is stored separately.

`verify_trip_audit_chain(job_id)` replays the same canonicalization to
recompute every row's hash and returns `(row_id, ok)`. The UI shows a
shield ✅ / ⚠️ badge derived from this call.

## Anti-tampering architecture

- **Server time is authoritative.** `server_time` is set from `now()`
  inside the definer function; nothing on the client can change it.
- **Hash chain per trip.** Any modification of `previous_state`,
  `new_state`, GPS fields, or `server_time` will fail
  `verify_trip_audit_chain`.
- **Signing via SECURITY DEFINER.** The row hash is the digital
  signature. No client-side secret exists.
- **Suspicious-activity view.** Aggregates from `trip_audit_log`
  itself (no jobs join) over 24 h / 7 d windows. Signals:
  `excessive_overrides`, `excessive_no_shows`,
  `excessive_wait_edits`, `gps_validation_failures`,
  `rejected_actions`.
- **RLS.** Direct INSERT blocked. UPDATE / DELETE revoked from
  `authenticated`.

## Grouped-trip architecture

- `group_stops` extends the existing `groups` table with an ordered
  stop list, per-stop timestamps, GPS anchor, pax count and charges.
- Coordinators can `reorderStops`, `splitGroup` (moves selected stops
  into a new group under the same job), and `mergeGroups` (moves all
  stops from source groups onto the target group, re-indexing).
- Driver can `requestStopReorderByDriver`; coordinator decides via
  `approveStopReorder`, which rewrites `stop_index` on approve and
  records `stop_reorder_decided` with `approval_status`.

## Testing checklist

See `docs/BATCH_C_MANUAL_TESTING.md` for the full 16-scenario suite.

## Known risks

- Chain contention: `FOR UPDATE` per trip serializes inserts; safe for
  one-driver-per-trip.
- Audit failures are trapped so a source workflow write is never
  rolled back. Failures surface as `RAISE WARNING` in database logs.
- `group_stops` is only populated when a coordinator (or import) fills
  it in. Legacy grouped jobs remain fully functional.

## Rollback

See `docs/BATCH_C_IMPLEMENTATION_PLAN.md` §8 for the full rollback
migration.
