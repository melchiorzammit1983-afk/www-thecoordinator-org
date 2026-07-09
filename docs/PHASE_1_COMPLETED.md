# Phase 1 — GPS Arrival Validation: Completed

> **Status:** ✅ Merged to main  
> **Date completed:** 2026-07-09  
> **Commits:** `0e95245` (refactor formatDriverStatusError), `86af2da` (per-company arrival_radius_m)

---

## 1. Objective

Prevent drivers from tapping **"Arrived at pickup"** unless they physically are within an acceptable
GPS distance of the booked pickup location.  The gate runs entirely server-side so it cannot be
bypassed by a modified client.

Goals:
- Require a GPS fix no older than 2 minutes before allowing the `en_route → arrived` status change.
- Reject a fix whose accuracy circle is wider than the effective arrival radius.
- Reject a fix whose Haversine distance to the pickup exceeds the effective arrival radius.
- Persist a full telemetry snapshot (lat, lng, accuracy, heading, speed, reverse-geocoded address,
  distance to pickup) on the job row at the moment of a valid arrival.
- Allow each company to configure its own arrival radius; fall back to the system default (150 m)
  when none is set.

---

## 2. Files Modified

| File | Change |
|------|--------|
| `src/lib/gps.constants.ts` | **New file.** Exports `DEFAULT_ARRIVAL_RADIUS_M = 150` and `ARRIVAL_GPS_FRESH_MS = 120_000`. |
| `src/lib/coordinator-public.functions.ts` | Added `haversineMeters` helper; imported GPS constants; added the full arrival gate inside `updateJobStatus` (steps 1-7). |
| `src/routes/m.driver.$token.tsx` | Added `formatDriverStatusError` to translate structured error codes into user-friendly toast messages. |
| `src/integrations/supabase/types.ts` | Added `arrival_radius_m` to `companies` Row / Insert / Update types; added all eight `arrival_*` columns to `jobs` types. |
| `supabase/migrations/20260709134000_a1b2c3d4-e5f6-7890-abcd-ef0123456789.sql` | **New migration.** Adds eight `arrival_*` columns to `public.jobs`. |
| `supabase/migrations/20260709135100_add_arrival_radius_m_to_companies.sql` | **New migration.** Adds `arrival_radius_m integer NULL` to `public.companies`. |

---

## 3. Database Changes

### `public.jobs` — eight new columns

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| `arrival_verified_at` | `timestamptz` | YES | Server-side timestamp of a validated arrival. |
| `arrival_lat` | `double precision` | YES | Driver latitude at arrival. |
| `arrival_lng` | `double precision` | YES | Driver longitude at arrival. |
| `arrival_accuracy_m` | `double precision` | YES | GPS horizontal accuracy radius in metres. |
| `arrival_heading` | `double precision` | YES | Bearing in degrees (0–360), if available. |
| `arrival_speed_mps` | `double precision` | YES | Speed in metres per second, if available. |
| `arrival_street_address` | `text` | YES | Reverse-geocoded address of the driver position (best-effort). |
| `arrival_distance_m` | `double precision` | YES | Haversine distance from driver to pickup in metres. |

All columns default to `NULL`.  Pre-existing rows are unaffected.

### `public.companies` — one new column

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| `arrival_radius_m` | `integer` | YES | Per-company override. `NULL` → use `DEFAULT_ARRIVAL_RADIUS_M` (150 m). |

---

## 4. GPS Validation Workflow

The gate fires **only** on the `en_route → arrived` status transition inside `updateJobStatus`
(`src/lib/coordinator-public.functions.ts`, lines 889-962).

```
Driver taps "Arrived at pickup"
        │
        ▼
[1] Read company.arrival_radius_m
    → effectiveRadius = company.arrival_radius_m ?? 150 m
        │
        ▼
[2] Query driver_locations for most-recent ping
    WHERE driver_id = job.driver_id
      AND job_id    = job.id
      AND captured_at >= now() - 2 minutes
    → if none found: throw arrival_no_gps
        │
        ▼
[3] Accuracy check
    if pt.accuracy_m > effectiveRadius:
        throw arrival_weak_gps:{accuracy}:{radius}
        │
        ▼
[4] Resolve pickup coordinates
    prefer job.pickup_lat / pickup_lng
    fallback: geocode job.from_location via Google Geocoding API
        │
        ▼
[5] Distance check  (only when pickup coords are known)
    distM = haversineMeters(driver, pickup)
    if distM > effectiveRadius:
        throw arrival_outside_radius:{dist}:{radius}
    else: patch.arrival_distance_m = distM
        │
        ▼
[6] Reverse-geocode driver position  (best-effort, never throws)
    GET /maps/api/geocode/json?latlng={lat},{lng}
    → patch.arrival_street_address = first formatted_address
        │
        ▼
[7] Persist telemetry
    patch: arrival_verified_at, arrival_lat, arrival_lng,
           arrival_accuracy_m, arrival_heading, arrival_speed_mps,
           arrival_street_address
    → combined with status = "arrived" in one UPDATE to jobs
```

---

## 5. Arrival Radius Workflow

The effective radius is resolved once per arrival attempt:

1. `updateJobStatus` fetches `companies.arrival_radius_m` for the job's company.
2. If the column is `NULL` (no override), `DEFAULT_ARRIVAL_RADIUS_M` (150 m) is used.
3. The resolved value is applied consistently to **both** the accuracy check (step 3) and the
   distance check (step 5).

To tighten the radius for a specific company (e.g. hotel drop-off requiring ≤ 50 m):

```sql
UPDATE public.companies
SET arrival_radius_m = 50
WHERE id = '<company-uuid>';
```

To restore the system default, set the column back to `NULL`.

---

## 6. Reverse Geocoding Workflow

- Called at step 6, after all blocking checks have passed.
- Uses the Google Geocoding API (`/maps/api/geocode/json?latlng=…`).
- Requires `GOOGLE_MAPS_API_KEY` to be set in the server environment; skipped silently if absent.
- Network or API errors are caught and ignored — a failure here never blocks the arrival.
- The first `formatted_address` from the response is stored in `jobs.arrival_street_address`.
- This field is informational only; it is not surfaced in the UI by Phase 1 but is available for
  reporting and auditing.

---

## 7. New Error Messages

### Server-side error codes (`coordinator-public.functions.ts`)

| Error thrown | Meaning |
|---|---|
| `arrival_no_gps` | No `driver_locations` row found within the last 2 minutes for this driver + job. |
| `arrival_weak_gps:{accuracy}:{radius}` | GPS fix exists but its accuracy circle (in metres) is wider than the effective radius. |
| `arrival_outside_radius:{dist}:{radius}` | GPS fix is accurate enough but the driver is more than `radius` metres from the pickup. |

### Client-side user messages (`m.driver.$token.tsx — formatDriverStatusError`)

| Error code | Toast shown to driver |
|---|---|
| `arrival_no_gps` | "No recent GPS location found. Make sure location sharing is active and try again." |
| `arrival_weak_gps:{accuracy}:{radius}` | "GPS accuracy is too weak (±{accuracy}m, need ±{radius}m). Wait for a better signal and try again." |
| `arrival_outside_radius:{dist}:{radius}` | "You're {dist}m from the pickup ({radius}m required). Move closer and try again." |

Any unrecognised error code falls through and is shown as-is (pre-existing behaviour).

---

## 8. Testing Checklist

See **[PHASE_1_MANUAL_TESTING.md](./PHASE_1_MANUAL_TESTING.md)** for the full step-by-step guide.

High-level checklist:

- [ ] Happy path: driver within radius, fresh GPS → arrival succeeds, telemetry persisted.
- [ ] `arrival_no_gps`: driver has no GPS row in last 2 min → correct toast shown.
- [ ] `arrival_weak_gps`: GPS accuracy wider than radius → correct toast with numbers.
- [ ] `arrival_outside_radius`: driver too far from pickup → correct toast with numbers.
- [ ] Company override: set `arrival_radius_m = 50` → tighter gate enforced.
- [ ] NULL override: reset to NULL → 150 m default applies.
- [ ] No `GOOGLE_MAPS_API_KEY`: arrival still succeeds; `arrival_street_address` is NULL.
- [ ] Pickup coords missing, geocoding fallback works → distance check still runs.
- [ ] Pickup coords missing and geocoding fails → distance check skipped, arrival succeeds if GPS is fresh and accurate.
- [ ] Non-`en_route → arrived` transitions are not affected by the gate.
- [ ] Existing tests still pass.

---

## 9. Known Risks

| Risk | Severity | Notes |
|---|---|---|
| Driver GPS disabled or denied | Medium | Returns `arrival_no_gps`. The driver must enable location on their device. No workaround within the app. |
| Weak urban-canyon signal | Medium | `arrival_weak_gps` will fire when GPS accuracy is poor (e.g. underground car parks). The driver needs to wait for a better fix or move to open sky. |
| Pickup address not geocodable | Low | If `from_location` cannot be geocoded and no stored coords exist, the distance check is skipped entirely and only the freshness + accuracy checks apply. This is a deliberate fail-open to avoid blocking legitimate arrivals when geodata is incomplete. |
| Google Maps API key absent | Low | Reverse geocoding is skipped silently. The gate still runs; `arrival_street_address` is stored as NULL. |
| Google Maps API quota exhausted | Low | Geocoding calls (both forward and reverse) are wrapped in try/catch and fail open. Arrival is never blocked by a billing failure on Google's side. |
| Clock skew between client and server | Low | `captured_at` is set server-side in `driver_locations` (or by the device clock reported to the server). A clock skew > 2 minutes on the driver device could cause spurious `arrival_no_gps` failures. |
| Haversine vs road distance | Low | The distance check uses straight-line Haversine, not road distance. This is acceptable for a 150 m proximity check. |

---

## 10. Rollback Steps

### If a quick revert is needed in production

1. **Disable the arrival gate at database level** (immediate, no deployment needed):

   ```sql
   -- Temporarily widen every company's radius to 999 km (effectively disabled).
   UPDATE public.companies SET arrival_radius_m = 999000;
   ```

   This makes every driver pass the distance check regardless of position.  Reverse with:

   ```sql
   UPDATE public.companies SET arrival_radius_m = NULL;
   ```

2. **Remove the gate from code** (requires a deployment):

   In `src/lib/coordinator-public.functions.ts`, delete the block between the comments
   `// ── Arrival gate` and `// ── End arrival gate ──` (approximately lines 889–962).
   Remove the import of `DEFAULT_ARRIVAL_RADIUS_M` and `ARRIVAL_GPS_FRESH_MS` from
   `./gps.constants` if no longer used.

3. **Revert database migrations** (only if the new columns cause issues):

   ```sql
   -- Remove telemetry columns from jobs
   ALTER TABLE public.jobs
     DROP COLUMN IF EXISTS arrival_verified_at,
     DROP COLUMN IF EXISTS arrival_lat,
     DROP COLUMN IF EXISTS arrival_lng,
     DROP COLUMN IF EXISTS arrival_accuracy_m,
     DROP COLUMN IF EXISTS arrival_heading,
     DROP COLUMN IF EXISTS arrival_speed_mps,
     DROP COLUMN IF EXISTS arrival_street_address,
     DROP COLUMN IF EXISTS arrival_distance_m;

   -- Remove arrival_radius_m from companies
   ALTER TABLE public.companies
     DROP COLUMN IF EXISTS arrival_radius_m;
   ```

   > ⚠️ Only run the column drops if no data has been written to them, or if the data is
   > intentionally being discarded.  These operations are destructive and irreversible.
