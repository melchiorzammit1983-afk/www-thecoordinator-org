# Batch C — Manual Testing

Every scenario below assumes a company `Acme`, coordinator user
`coord@acme.test`, driver `Dave`, and one active trip `T1` unless
noted.

**Database verification** rows are the exact queries a reviewer can
run in the SQL console.

---

## 1. Audit row on trip status change

### Setup
- `T1` in status `pending`.

### Actions
- Coordinator moves the trip to `en_route` in the calendar.

### Expected
- TripDetailsSheet → **Audit trail** shows a new
  `Status change` event with the approval-status pill `not required`.
- Chain-integrity badge is green.

### Database
```sql
SELECT event_type, previous_state, new_state, approval_status, actor_label
FROM trip_audit_log WHERE job_id = '<T1>' ORDER BY created_at DESC LIMIT 1;
```

---

## 2. Audit row on waiting session start / end

### Actions
- Driver marks arrival; waiting starts automatically.
- Driver marks passenger on board; waiting ends.

### Expected
- Two audit rows: `wait_started` then `wait_ended`, `actor_label =
  system`.

### Database
```sql
SELECT event_type, actor_label FROM trip_audit_log
WHERE job_id = '<T1>' AND event_type LIKE 'wait_%' ORDER BY created_at;
```

---

## 3. Audit row on boarding approval

### Actions
- Driver taps **Confirm boarding** and coordinator approves.

### Expected
- Rows: `boarding_started` (`pending`), `boarding_approved`
  (`approved`).

### Database
```sql
SELECT event_type, approval_status FROM trip_audit_log
WHERE job_id = '<T1>' AND event_type LIKE 'boarding_%';
```

---

## 4. Audit row on passenger no-show

### Actions
- Driver marks a pax as no-show.

### Expected
- Row `pax_no_show`, `actor_label = coordinator|driver`.

### Database
```sql
SELECT * FROM trip_audit_log
WHERE job_id = '<T1>' AND event_type = 'pax_no_show';
```

---

## 5. Audit row on emergency override

### Actions
- Driver triggers Emergency Override → Force Arrived, attaches photo
  and note.

### Expected
- Row `override_arrived`, `approval_status = overridden`, GPS +
  street_address populated.

### Database
```sql
SELECT event_type, approval_status, gps_lat, gps_lng, street_address, notes
FROM trip_audit_log WHERE job_id = '<T1>' AND event_type LIKE 'override_%'
ORDER BY created_at DESC LIMIT 1;
```

---

## 6. Audit row on safety concern

### Actions
- Driver triggers Emergency Override with reason `safety_concern`.

### Expected
- Row `safety_concern`; job `safety_flag_at` is set (unchanged Batch B
  behaviour); coordinator sees red flag badge.

### Database
```sql
SELECT event_type FROM trip_audit_log
WHERE job_id = '<T1>' AND event_type = 'safety_concern';
```

---

## 7. Audit row on breakdown

### Actions
- Driver triggers Emergency Override with reason `breakdown`.

### Expected
- Row `breakdown`; job `breakdown_flag_at` set.

### Database
```sql
SELECT event_type FROM trip_audit_log
WHERE job_id = '<T1>' AND event_type = 'breakdown';
```

---

## 8. Chain integrity — happy path

### Actions
- Complete a full trip lifecycle producing ≥ 5 audit rows.

### Expected
- Audit timeline badge is **Chain verified** (green).

### Database
```sql
SELECT bool_and(ok) AS chain_ok FROM verify_trip_audit_chain('<T1>');
-- expected: t
```

---

## 9. Chain integrity — tamper detection

### Setup
- Existing chain from Scenario 8.

### Actions
- As `service_role` (SQL console), mutate one row's `notes`:
  ```sql
  UPDATE trip_audit_log SET notes = 'tampered'
  WHERE job_id = '<T1>' ORDER BY created_at LIMIT 1;
  ```

### Expected
- Audit timeline badge flips to **Chain broken**.
- Every subsequent row is highlighted red.

### Database
```sql
SELECT row_id, ok FROM verify_trip_audit_chain('<T1>');
```

---

## 10. Direct INSERT is blocked

### Actions
- As `authenticated` coordinator, run
  ```sql
  INSERT INTO trip_audit_log (company_id, event_type, row_hash)
  VALUES ('<C>', 'status_change', 'x');
  ```

### Expected
- `new row violates row-level security policy for table
  "trip_audit_log"`.

---

## 11. UPDATE / DELETE are blocked

### Actions
- `UPDATE trip_audit_log SET notes = 'x' WHERE …`
- `DELETE FROM trip_audit_log WHERE …`

### Expected
- Both fail with `permission denied for table trip_audit_log`.

---

## 12. Suspicious activity — excessive overrides

### Setup
- Same driver triggers **≥ 3** emergency overrides in 24 h across any
  trips.

### Expected
- Coordinator dashboard shows **Suspicious activity** card with
  `Excessive overrides` and count.

### Database
```sql
SELECT * FROM v_suspicious_activity WHERE driver_id = '<Dave>';
```

---

## 13. Suspicious activity — rejected actions

### Setup
- Coordinator rejects **≥ 2** driver stop-reorder requests within 24 h.

### Expected
- Suspicious activity card shows `Rejected actions`.

---

## 14. Grouped trip stops — coordinator reorder

### Setup
- Group `G1` with 5 `group_stops` rows (`stop_index` 0..4).

### Actions
- Open TripDetailsSheet for the group's job → expand
  **Grouped run · 5 stops** → move stop 3 up twice.

### Expected
- Order refreshed; audit row `stop_reordered` with
  `approval_status = approved`.

### Database
```sql
SELECT id, stop_index FROM group_stops WHERE group_id = '<G1>'
ORDER BY stop_index;
```

---

## 15. Grouped trip stops — driver reorder request

### Setup
- Group `G1` as above.

### Actions
- Driver opens the trip on the driver PWA → **🔀 Reorder stops** →
  rearranges → **Send request**.

### Expected
- Driver sees "Waiting for coordinator".
- Audit row `stop_reorder_requested` with `approval_status = pending`.
- Coordinator dashboard / trip sheet shows pending request badge.

### Database
```sql
SELECT id, status, proposed_order FROM group_stop_reorder_requests
WHERE group_id = '<G1>' ORDER BY created_at DESC LIMIT 1;
```

---

## 16. Grouped trip stops — coordinator decides driver request

### Actions
- Coordinator opens `GroupStopsPanel` → **Approve** the pending
  request.

### Expected
- `stop_index` on `group_stops` rewritten to match `proposed_order`.
- Audit row `stop_reorder_decided` with `approval_status = approved`.
- Rejecting instead produces `approval_status = rejected` and leaves
  order unchanged.

### Database
```sql
SELECT event_type, approval_status FROM trip_audit_log
WHERE group_id = '<G1>' AND event_type = 'stop_reorder_decided'
ORDER BY created_at DESC LIMIT 1;
```

---

## Regression checklist (must remain green)

- Phase 1 arrival-radius validation still gates verified arrivals.
- Batch A waiting timer still stops when the driver marks
  `in_progress` / `completed`.
- Batch A boarding approval buttons still visible in the coordinator
  UI.
- Batch B Safety Mode overlay activates > 10 km/h; Emergency
  Override dialog still uploads photo and captures GPS.
- Coordinator dashboard KPIs still render above the new Suspicious
  activity card.
