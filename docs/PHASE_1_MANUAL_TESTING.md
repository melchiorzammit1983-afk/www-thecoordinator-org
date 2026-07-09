# Phase 1 — GPS Arrival Validation: Manual Testing Guide

> **Scope:** Tests that must be performed manually in a browser/device before Phase 1 is
> considered production-ready.  No automated test runner covers the GPS + Google Maps API
> integration paths.

---

## Prerequisites

| Item | Details |
|------|---------|
| Environment | Staging or local dev with a real Supabase project (migrations applied). |
| Google Maps API key | `GOOGLE_MAPS_API_KEY` set in the server `.env`.  Have a second environment with the key **absent** for test TC-06. |
| Driver token | A valid driver magic-link token for a job that is currently in `en_route` status. |
| Supabase access | Direct DB access (Supabase Studio or `psql`) to insert test rows and verify results. |
| Browser DevTools | Open the Network tab and Console for all tests. |

---

## Test Environment Setup

### Create a test job in `en_route`

```sql
-- 1. Find or create a test company
SELECT id, name, arrival_radius_m FROM public.companies LIMIT 5;

-- 2. Find or create a test job assigned to a driver, currently in en_route
SELECT id, status, driver_id, from_location, pickup_lat, pickup_lng, company_id
FROM public.jobs
WHERE status = 'en_route'
LIMIT 5;
```

Keep the `job.id`, `job.driver_id`, `job.company_id`, and `job.pickup_lat` / `job.pickup_lng`
(or `from_location`) handy — you will need them to insert mock GPS rows.

### Insert a mock GPS location for the driver

```sql
-- Replace the UUIDs and coordinates with your test values.
INSERT INTO public.driver_locations
  (driver_id, job_id, latitude, longitude, accuracy_m, heading, speed_mps, captured_at)
VALUES
  ('<driver-uuid>', '<job-uuid>',
   <lat>, <lng>,         -- position of the driver
   <accuracy>,           -- GPS accuracy in metres (e.g. 15)
   90,                   -- heading (degrees)
   5.5,                  -- speed (m/s)
   NOW()                 -- fresh timestamp
  );
```

---

## Test Cases

---

### TC-01 — Happy Path: Driver Within Radius, Fresh GPS

**Goal:** Arrival succeeds; full telemetry persisted.

**Setup:**
- Company `arrival_radius_m` = NULL (use default 150 m).
- Insert a `driver_locations` row with `captured_at = NOW()`, `accuracy_m = 10`,
  and coordinates **within 100 m** of the job's pickup location.

**Steps:**
1. Open the driver mobile page (`/m/driver/<token>`).
2. Confirm the trip shows status **En Route**.
3. Tap **"Arrived at pickup"**.

**Expected results:**
- Status changes to **Arrived** in the UI.
- No error toast appears.
- Database verification:

  ```sql
  SELECT
    status,
    arrival_verified_at,
    arrival_lat, arrival_lng,
    arrival_accuracy_m,
    arrival_heading,
    arrival_speed_mps,
    arrival_street_address,
    arrival_distance_m
  FROM public.jobs
  WHERE id = '<job-uuid>';
  ```

  - `status = 'arrived'`
  - `arrival_verified_at` is a recent timestamp (within the last minute).
  - `arrival_lat`, `arrival_lng` match the values inserted in `driver_locations`.
  - `arrival_accuracy_m = 10`.
  - `arrival_heading` and `arrival_speed_mps` are populated.
  - `arrival_street_address` is a non-null human-readable address string.
  - `arrival_distance_m` is a number ≤ 100.

---

### TC-02 — No GPS: `arrival_no_gps`

**Goal:** Arrival blocked when no fresh GPS row exists.

**Setup:**
- Do **not** insert any `driver_locations` row for this driver + job combination.
  If one exists, either delete it or set `captured_at` to more than 2 minutes ago:

  ```sql
  UPDATE public.driver_locations
  SET captured_at = NOW() - INTERVAL '5 minutes'
  WHERE driver_id = '<driver-uuid>' AND job_id = '<job-uuid>';
  ```

**Steps:**
1. Open the driver page.
2. Confirm the job is in **En Route**.
3. Tap **"Arrived at pickup"**.

**Expected results:**
- A red error toast appears: **"No recent GPS location found. Make sure location sharing is
  active and try again."**
- Job status remains **En Route**.
- No `arrival_*` columns are written on the job row.

---

### TC-03 — Weak GPS: `arrival_weak_gps`

**Goal:** Arrival blocked when GPS accuracy circle exceeds the effective radius.

**Setup:**
- Company `arrival_radius_m` = NULL (150 m effective).
- Insert a `driver_locations` row with `captured_at = NOW()`, but `accuracy_m = 200`
  (wider than 150 m):

  ```sql
  INSERT INTO public.driver_locations
    (driver_id, job_id, latitude, longitude, accuracy_m, heading, speed_mps, captured_at)
  VALUES
    ('<driver-uuid>', '<job-uuid>', <lat>, <lng>, 200, 0, 0, NOW());
  ```

**Steps:**
1. Open the driver page; job is **En Route**.
2. Tap **"Arrived at pickup"**.

**Expected results:**
- Error toast: **"GPS accuracy is too weak (±200m, need ±150m). Wait for a better signal and
  try again."**
- Job status remains **En Route**.

**Variant:** Repeat with `arrival_radius_m = 50` on the company and `accuracy_m = 80`.
Expected toast: `"GPS accuracy is too weak (±80m, need ±50m). Wait for a better signal and try again."`

---

### TC-04 — Outside Radius: `arrival_outside_radius`

**Goal:** Arrival blocked when driver is too far from the pickup.

**Setup:**
- Company `arrival_radius_m` = NULL (150 m effective).
- Job has `pickup_lat` / `pickup_lng` set (or a geocodable `from_location`).
- Insert a `driver_locations` row with `captured_at = NOW()`, `accuracy_m = 10`,
  and coordinates **500 m away** from the pickup:

  ```sql
  -- Pick a lat/lng that is ~500 m from the actual pickup.
  INSERT INTO public.driver_locations
    (driver_id, job_id, latitude, longitude, accuracy_m, heading, speed_mps, captured_at)
  VALUES
    ('<driver-uuid>', '<job-uuid>', <far-lat>, <far-lng>, 10, 0, 0, NOW());
  ```

**Steps:**
1. Open the driver page; job is **En Route**.
2. Tap **"Arrived at pickup"**.

**Expected results:**
- Error toast: **"You're 500m from the pickup (150m required). Move closer and try again."**
  (Exact distance may vary slightly due to Haversine rounding.)
- Job status remains **En Route**.

---

### TC-05 — Per-Company Arrival Radius Override

**Goal:** A company-level `arrival_radius_m` tightens (or loosens) the gate.

**Scenario A — Tighter radius (50 m)**

1. Set the company override:

   ```sql
   UPDATE public.companies SET arrival_radius_m = 50 WHERE id = '<company-uuid>';
   ```

2. Insert a `driver_locations` row with `accuracy_m = 10` and coordinates **80 m** from the pickup.
3. Tap **"Arrived at pickup"**.
4. Expected: `arrival_outside_radius` error — "You're 80m from the pickup (50m required)."

5. Now move the mock GPS to **30 m** from the pickup (re-insert row with updated coords).
6. Tap **"Arrived at pickup"** again.
7. Expected: arrival succeeds; `arrival_distance_m ≈ 30`.

**Scenario B — NULL resets to default**

1. Reset the company:

   ```sql
   UPDATE public.companies SET arrival_radius_m = NULL WHERE id = '<company-uuid>';
   ```

2. Keep the same GPS point 80 m from the pickup.
3. Tap **"Arrived at pickup"**.
4. Expected: arrival succeeds (80 m < 150 m default).

---

### TC-06 — No Google Maps API Key

**Goal:** Reverse geocoding is skipped; arrival still succeeds; `arrival_street_address = NULL`.

**Setup:**
- Run against an environment where `GOOGLE_MAPS_API_KEY` is absent or empty.
- Insert a valid (fresh, accurate, close) GPS row.

**Steps:**
1. Tap **"Arrived at pickup"**.

**Expected results:**
- Arrival succeeds; no error toast.
- Database:

  ```sql
  SELECT arrival_street_address FROM public.jobs WHERE id = '<job-uuid>';
  ```

  Returns `NULL` (no address was geocoded).
- All other `arrival_*` columns are populated normally.

---

### TC-07 — Pickup Coords Missing, Geocoding Fallback

**Goal:** When `pickup_lat` / `pickup_lng` are NULL but `from_location` is a geocodable address,
the distance check still runs.

**Setup:**
- Job has `pickup_lat = NULL`, `pickup_lng = NULL` and a valid text `from_location` (e.g.
  `"Hilton Malta, St Julian's"`).
- `GOOGLE_MAPS_API_KEY` is set.
- Insert a fresh, accurate GPS row within 100 m of the actual coordinates of that address.

**Steps:**
1. Tap **"Arrived at pickup"**.

**Expected results:**
- Arrival succeeds; `arrival_distance_m` is populated.

---

### TC-08 — Pickup Coords Missing, Geocoding Also Fails

**Goal:** When neither stored coords nor geocoding resolves the pickup, the distance check is
skipped and arrival succeeds on freshness + accuracy alone.

**Setup:**
- Job has `pickup_lat = NULL`, `pickup_lng = NULL`, `from_location = 'Unknown XYZ'` (not
  geocodable).
- Insert a fresh, accurate GPS row (any coordinates).

**Steps:**
1. Tap **"Arrived at pickup"**.

**Expected results:**
- Arrival succeeds.
- `arrival_distance_m = NULL` (no distance computed).
- No error toast.

---

### TC-09 — Gate Does Not Fire on Other Transitions

**Goal:** Verify that non-`arrived` status changes are unaffected.

**Steps:**
1. With a job in `pending` status, advance it to `en_route` via the driver UI.
   - Expected: status changes; no GPS check; no `arrival_*` columns written.
2. With a job in `arrived` status, advance it to `in_progress`.
   - Expected: status changes; no GPS check.
3. With a job in `in_progress` status, advance it to `completed`.
   - Expected: status changes; no GPS check; `driver_completed_at` is set.

---

### TC-10 — Stale GPS Exactly at the Boundary

**Goal:** Confirm the 2-minute window is enforced correctly.

**Scenario A — 1 minute 59 seconds ago (should pass)**

```sql
INSERT INTO public.driver_locations
  (driver_id, job_id, latitude, longitude, accuracy_m, heading, speed_mps, captured_at)
VALUES
  ('<driver-uuid>', '<job-uuid>', <near-lat>, <near-lng>, 10, 0, 0,
   NOW() - INTERVAL '119 seconds');
```

Tap **"Arrived at pickup"** → should succeed.

**Scenario B — 2 minutes 1 second ago (should fail)**

```sql
UPDATE public.driver_locations
SET captured_at = NOW() - INTERVAL '121 seconds'
WHERE driver_id = '<driver-uuid>' AND job_id = '<job-uuid>';
```

Tap **"Arrived at pickup"** → should return `arrival_no_gps` error.

---

## Post-Test Database Cleanup

```sql
-- Reset test jobs back to en_route for re-use
UPDATE public.jobs SET
  status = 'en_route',
  arrival_verified_at  = NULL,
  arrival_lat          = NULL,
  arrival_lng          = NULL,
  arrival_accuracy_m   = NULL,
  arrival_heading      = NULL,
  arrival_speed_mps    = NULL,
  arrival_street_address = NULL,
  arrival_distance_m   = NULL
WHERE id = '<job-uuid>';

-- Remove test GPS rows
DELETE FROM public.driver_locations
WHERE driver_id = '<driver-uuid>' AND job_id = '<job-uuid>';

-- Reset company radius
UPDATE public.companies SET arrival_radius_m = NULL WHERE id = '<company-uuid>';
```

---

## Acceptance Criteria Summary

| TC | Scenario | Pass condition |
|----|----------|---------------|
| TC-01 | Happy path | Status → arrived; all `arrival_*` columns populated |
| TC-02 | No GPS | `arrival_no_gps` toast; status unchanged |
| TC-03 | Weak GPS | `arrival_weak_gps` toast with correct numbers |
| TC-04 | Outside radius | `arrival_outside_radius` toast with correct numbers |
| TC-05A | Company 50 m radius tight | 80 m blocked; 30 m passes |
| TC-05B | Company NULL → 150 m default | 80 m passes |
| TC-06 | No API key | Arrival succeeds; `arrival_street_address = NULL` |
| TC-07 | Geocoding fallback | Arrival succeeds; `arrival_distance_m` populated |
| TC-08 | Geocoding fails + no coords | Arrival succeeds; `arrival_distance_m = NULL` |
| TC-09 | Other status transitions | No gate; no columns written |
| TC-10A | GPS 119 s old | Arrival succeeds |
| TC-10B | GPS 121 s old | `arrival_no_gps` toast |
