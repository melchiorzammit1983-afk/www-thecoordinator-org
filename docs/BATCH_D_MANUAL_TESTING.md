# Batch D — Manual Testing

Covers Batch D features plus regression checklists for Phase 1 → Batch C.

Legend:
- **Setup** — starting DB state.
- **Actions** — steps to perform in the UI.
- **Expected** — user-visible outcome.
- **Verify** — SQL / DB verification.

---

## D-01 Route Optimization: happy path

**Setup**
- One coordinator company with a job containing a group of 4 stops, all
  with lat/lng coordinates.
- Company points balance ≥ 10.

**Actions**
1. Open the trip on the coordinator calendar.
2. Expand the group panel.
3. Click **Suggest better order**.

**Expected**
- Button shows “Analysing…” for a few seconds.
- A pending suggestion card appears with current vs suggested duration
  and distance, and a 1-line reasoning.
- Points balance reduced by 3.

**Verify**
```sql
select status, model, distance_meters_original, distance_meters_suggested,
       duration_seconds_original, duration_seconds_suggested
  from group_route_optimizations
 where group_id = '<group>' order by created_at desc limit 1;

select points_deducted, note from points_ledger
 where feature_key = 'route_optimization'
 order by created_at desc limit 1;
```

---

## D-02 Route Optimization: approve

**Actions**
1. Continuing from D-01, click **Apply**.

**Expected**
- Stops reorder to the suggested order.
- Any pending driver reorder request marked superseded.

**Verify**
```sql
select id, stop_index from group_stops where group_id = '<group>' order by stop_index;
select status, approved_order, decided_by_user_id, decided_at
  from group_route_optimizations where id = '<opt-id>';
select event_type, approval_status from trip_audit_log
 where job_id = '<job>' order by created_at desc limit 5;
-- Expect a `route_optimization_approved` event with approval_status='approved'.
```

---

## D-03 Route Optimization: reject

**Setup** — fresh pending suggestion (rerun D-01).

**Actions**
1. Click **Reject**.

**Expected**
- Row status becomes `rejected`. No `stop_index` changes.
- Audit event `route_optimization_rejected` recorded.

---

## D-04 Route Optimization: fewer than 3 stops

**Setup** — group with 2 stops.

**Expected**
- Suggest button is disabled with hint “Need at least 3 stops…”.
- No points spent.

---

## D-05 Route Optimization: insufficient points

**Setup** — set company points balance to 0.

**Actions** — click **Suggest better order**.

**Expected**
- Toast error `insufficient_points`.
- No row inserted in `group_route_optimizations`.

---

## D-06 Route Optimization: AI hallucination guard

**Setup** — enable a flag to force the model to return a bad order (or
test by manually breaking the response in dev tools).

**Expected**
- Points still charged (matches existing AI feature behavior).
- Toast error `ai_returned_invalid_order`.
- No pending row inserted.

---

## D-07 Auto Next Job: happy path

**Setup**
- Driver has 2 assigned upcoming jobs (A at 10:00, B at 12:00).
- Both accepted; A is in progress.

**Actions**
1. On the driver PWA, mark trip A **completed**.

**Expected**
- After the next manifest refetch (≤ 20 s), a bottom sheet appears:
  “✅ Trip completed · Next up” showing trip B’s pickup time, from, to,
  and “Start navigation” + “Open trip” buttons.

---

## D-08 Auto Next Job: no upcoming trip

**Setup** — driver has no other assigned trips after completion.

**Expected** — no sheet appears.

---

## D-09 Auto Next Job: snooze

**Actions**
1. Trigger the sheet (D-07).
2. Tap **Dismiss (snooze 15 min)**.
3. Complete another trip within 15 minutes.

**Expected** — sheet does NOT reappear until 15 minutes have elapsed.

**Verify** — `localStorage.getItem('auto-next-job-snooze-until')` returns
a future ms timestamp.

---

## D-10 Auto Next Job: company toggle off

**Setup**
```sql
update companies set auto_next_job_enabled = false where id = '<company>';
```

**Expected** — sheet never appears regardless of completions.

---

## D-11 Production Readiness: index in use

**Actions**
```sql
explain analyse
select id, pickup_at from jobs
 where driver_id = '<driver>' and pickup_at > now()
 order by pickup_at limit 1;
```

**Expected** — plan uses `idx_jobs_driver_pickup`.

---

## Regression checklist (Phase 1 → Batch C)

### GPS validation
- Driver can still mark **Arrived** even when GPS is weak (Batch B
  best-effort gate). `arrival_verified_at` set only when checks pass.

### Waiting
- Waiting session auto-closes when a trip transitions to `in_progress`
  or `completed` (regression coverage from earlier fix).
- Stop-waiting button remains visible on a `completed` trip if a
  session is still open.

### Boarding approvals
- Coordinator approval / driver override still work; `job_boarding_approvals`
  triggers `record_trip_audit`.

### Approvals (Batch C)
- Driver requests stop reorder → coordinator approve/reject → audit rows
  logged with `approval_status`.

### Overrides (Batch B)
- Emergency override with photo + reverse-geocoded address still stored
  in `job_emergency_overrides` and mirrored to audit trail.

### Safety mode
- UI locks when speed > 10 km/h; unlock button gives 30 s bypass.
- Emergency Override and Status buttons remain accessible.

### Audit trail
```sql
select ok, count(*) from verify_trip_audit_chain('<job>') group by ok;
-- Expect every row ok = true.
```

### Grouped trips
- 5+ stops display, per-stop arrived/boarded/no-show/charges chips
  still render.

### Route optimization
- See D-01 … D-06 above.

### Auto Next Job
- See D-07 … D-10 above.

---

## Rollback verification

After running the rollback SQL block from `BATCH_D_COMPLETED.md`:
- `group_route_optimizations` table gone.
- `companies.auto_next_job_enabled` column gone.
- Coordinator opens the group panel → no Route Optimization card, no
  errors. Driver completes a trip → no bottom sheet.
- Existing Batch A/B/C functionality unchanged.
