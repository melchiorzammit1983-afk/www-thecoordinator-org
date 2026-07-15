# Batch B — Manual Testing Guide

End-to-end scenarios for Driver Safety Mode and the Emergency Override
system. Each scenario is written to be run against a live preview with at
least one company, one coordinator user, one driver token, and one active
job that is not yet completed. "DB verification" queries assume access to
the backend read-only SQL runner.

Shared prerequisites (do once):

- Company row exists with `safety_mode_enabled = true`,
  `safety_mode_allow_override = true`, `safety_mode_threshold_kmh = 10`.
- Driver has a valid manifest token: open `/m/driver/<token>`.
- At least one job assigned to that driver in status `en_route` or
  `arrived` unless the scenario says otherwise.
- Coordinator is signed in in a second browser on
  `/coordinator/calendar`, with the same job's Trip Details Sheet open.

---

## 1. Safety Mode Activation

Setup: Driver manifest open, company defaults, job in `en_route`.
Driver actions:
1. Grant GPS permission when prompted.
2. Simulate speed ≥ 10 km/h (Chrome DevTools → Sensors → Geolocation with
   a moving coordinate, or physically drive).
Coordinator actions: none.
Expected result:
- Yellow `🚗 SAFETY MODE ACTIVE · <n> km/h · Distracting options hidden`
  banner appears at the top of the manifest.
- Overflow menu, Edit, Give-back, Back-to-waiting, mark paid/pending,
  hide/restore, and billing panels disappear.
- Navigation, status buttons, passenger summary, chat, and the Emergency
  Override button remain visible.
DB verification: none (client-side derivation only).

## 2. Safety Mode Deactivation

Setup: Continue from scenario 1 with Safety Mode active.
Driver actions: drop simulated speed below threshold (e.g. 0 km/h) and
wait up to 30 s, or stop the GPS stream entirely.
Expected result: banner disappears within ~30 s, hidden controls return.
DB verification: none.

## 3. Safety Override Unlock (30 s)

Setup: Safety Mode active (scenario 1), company
`safety_mode_allow_override = true`.
Driver actions:
1. Tap `Unlock 30 s` on the Safety Mode banner.
2. Interact with a previously-hidden control (e.g. open overflow menu).
3. Wait 30 s without further interaction.
Expected result:
- Banner hides immediately, all controls return.
- After ~30 s while speed is still ≥ 10 km/h, Safety Mode re-engages.
DB verification: none.

## 4. Force Arrived

Setup: Job status `en_route`, driver manifest open.
Driver actions:
1. Tap Emergency Override.
2. Select `Force Arrived`, reason `GPS Issue`, add note "Testing arrival".
3. Skip photo, allow geolocation, tap Continue then Confirm Override.
Coordinator actions: refresh Trip Details Sheet.
Expected result:
- Job moves to `arrived`.
- Toast "Emergency override applied — coordinator notified".
DB verification:
```sql
select status from public.jobs where id = '<job_id>';
select from_status, to_status, reason, gps_lat, gps_lng, street_address
  from public.job_emergency_overrides
  where job_id = '<job_id>' order by created_at desc limit 1;
```
Expect `to_status = 'arrived'`, `reason = 'gps_issue'`, non-null gps
fields, non-null `street_address`.

## 5. Force Passenger On Board

Setup: Job in `arrived`.
Driver actions: Emergency Override → `Force Passenger On Board`, reason
`Passenger Already On Board`. Confirm.
Expected result: status becomes `in_progress`.
DB verification:
```sql
select status from public.jobs where id = '<job_id>';
select to_status, reason from public.job_emergency_overrides
  where job_id = '<job_id>' order by created_at desc limit 1;
```
Expect `to_status = 'in_progress'`, `reason = 'passenger_already_on_board'`.

## 6. Force En Route

Setup: Job in `arrived` (or `in_progress`).
Driver actions: Emergency Override → `Force En Route`, reason
`Wrong Pickup Pin`. Confirm.
Expected result: status becomes `en_route` (backwards transition allowed
because it is an emergency override).
DB verification: `jobs.status = 'en_route'`; latest override row has
`to_status = 'en_route'`, `reason = 'wrong_pickup_pin'`.

## 7. Force Drop Off

Setup: Job in `in_progress`.
Driver actions: Emergency Override → `Force Drop Off`, reason
`Auto Status Failure`. Confirm.
Expected result: status becomes `completed`.
DB verification: `jobs.status = 'completed'`; latest override
`to_status = 'completed'`, `reason = 'auto_status_failed'`.

## 8. Force Complete

Setup: Job in `en_route` (skip drop-off intentionally).
Driver actions: Emergency Override → `Force Complete`, reason
`Road Closure`. Confirm.
Expected result: status becomes `completed`, trip disappears from active
board.
DB verification: `jobs.status = 'completed'`; latest override row
`to_status = 'completed'`, `reason = 'road_closure'`.

## 9. Safety Concern Workflow

Setup: Job in `en_route`.
Driver actions: Emergency Override → any Force action → reason
`Safety Concern`, add descriptive note. Confirm.
Coordinator actions: reload Trip Details Sheet.
Expected result:
- Red destructive `Safety concern flagged` badge appears in the sheet
  with a `Clear` action.
- Trip is highlighted on the coordinator board.
DB verification:
```sql
select safety_flag_at, breakdown_flag_at from public.jobs where id = '<job_id>';
```
`safety_flag_at` is non-null.

## 10. Vehicle Breakdown Workflow

Setup: Job in `arrived` or `in_progress`.
Driver actions: Emergency Override → `Force Complete` (or any) → reason
`Vehicle Breakdown`. Confirm.
Coordinator actions: reload Trip Details Sheet.
Expected result:
- Red `Vehicle breakdown` badge with `Clear` action shows in the sheet.
- Coordinator can reassign the trip.
DB verification:
```sql
select breakdown_flag_at from public.jobs where id = '<job_id>';
select pax_count, vehicle_label from public.job_emergency_overrides
  where job_id = '<job_id>' order by created_at desc limit 1;
```
`breakdown_flag_at` is non-null; snapshot columns populated.

## 11. Override Photo Upload

Setup: Any override-eligible job.
Driver actions:
1. Open Emergency Override.
2. Tap `Attach photo`, take a picture (or upload a <5 MB image).
3. Complete override.
4. Attempt to attach an image >5 MB.
Expected result:
- Small photo preview shows in dialog and confirmation step.
- Large photo triggers toast "Photo is too large (max 5 MB)" and is not
  attached.
- After confirmation, the override record has a signed URL that opens
  the uploaded image.
DB verification:
```sql
select photo_url, photo_path from public.job_emergency_overrides
  where job_id = '<job_id>' order by created_at desc limit 1;
```
Both fields non-null. Confirm the object exists in the private
`override-photos` bucket at the returned `photo_path`.

## 12. Override GPS Capture

Setup: Any override-eligible job. Ensure browser grants location.
Driver actions: perform any override.
Expected result: dialog closes without geolocation error.
DB verification:
```sql
select gps_lat, gps_lng, gps_accuracy_m, street_address, speed_mps
  from public.job_emergency_overrides
  where job_id = '<job_id>' order by created_at desc limit 1;
```
`gps_lat`, `gps_lng`, `gps_accuracy_m` populated; `street_address` set
by reverse geocode; `speed_mps` reflects last telemetry (may be null if
no recent ping).

Denied-GPS variant: revoke geolocation permission and repeat. Override
still succeeds; `gps_*` and `street_address` are null but the row is
written.

## 13. Coordinator Flag Visibility

Setup: A job with an active `safety_flag_at` or `breakdown_flag_at`
(from scenarios 9 or 10).
Coordinator actions:
1. Open the coordinator calendar.
2. Open the Trip Details Sheet for that job.
Expected result:
- The sheet shows a destructive red badge naming the flag type.
- A `Clear` button is visible next to the badge.
DB verification: same as scenarios 9/10.

## 14. Coordinator Flag Clear

Setup: Continue from scenario 13.
Coordinator actions: click `Clear` on the badge.
Expected result:
- Badge disappears.
- Success toast confirms the action.
DB verification:
```sql
select safety_flag_at, breakdown_flag_at from public.jobs where id = '<job_id>';
```
Both fields are `null`. Prior override rows remain intact.

## 15. Company Safety Mode Disabled

Setup: Update the company row:
```sql
update public.companies set safety_mode_enabled = false where id = '<company_id>';
```
Reload the driver manifest.
Driver actions: simulate speed ≥ 10 km/h.
Expected result:
- Safety Mode banner never appears.
- All hidden actions (Edit, Give-back, overflow menu, etc.) stay
  available while driving.
- Emergency Override button still works normally.
DB verification:
```sql
select safety_mode_enabled from public.companies where id = '<company_id>';
```
`safety_mode_enabled = false`.

## 16. Company Safety Mode Enabled

Setup: Re-enable:
```sql
update public.companies
   set safety_mode_enabled = true,
       safety_mode_allow_override = true,
       safety_mode_threshold_kmh = 10
 where id = '<company_id>';
```
Reload the driver manifest.
Driver actions: simulate speed ≥ 10 km/h.
Expected result:
- Safety Mode banner returns.
- `Unlock 30 s` button visible (because override is allowed).
- Toggle `safety_mode_allow_override = false` and reload → banner still
  shows, but the Unlock button is hidden.
DB verification: values from the updates above are reflected in
`public.companies`.

---

## Regression checklist (run after all scenarios)

- Phase 1 GPS arrival verification still stamps `arrival_verified_at`
  when the driver actually reaches the pickup.
- Batch A waiting sessions still close on `in_progress` and `completed`.
- Non-override status transitions still enforce the normal state
  machine (no backwards transitions outside overrides).
- No new console errors on driver manifest, coordinator calendar, or
  Trip Details Sheet.
