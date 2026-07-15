# Batch B — Driver Safety Mode + Emergency Override

Implemented on top of the pre-existing Phase 4/5 groundwork, expanding it to
meet the full Batch B specification without touching Phase 1 or Batch A.

## What changed

### Safety Mode
- Added company-level toggles: `companies.safety_mode_enabled` and
  `companies.safety_mode_allow_override` (both default `true`), alongside the
  existing `safety_mode_threshold_kmh`.
- Driver manifest now surfaces all three settings.
- `useSafetyMode` respects the company master switch and a temporary
  "Unlock 30s" bypass (only offered when the company allows override).
- `SafetyModeOverlay` shows the required "SAFETY MODE ACTIVE" chip, current
  km/h, and the optional Unlock 30s button.
- Driver UI already gated Edit / Give-back / Payment toggles / etc. behind
  `isSafetyMode`; that behaviour continues, now paired with the unlock.

### Emergency Override
- Reasons now match the spec: GPS Issue, Wrong Pickup Pin, Passenger
  Requested Different Pickup, Auto Status Failure, **Road Closure**,
  Vehicle Breakdown, **Passenger Already On Board**, Safety Concern, Other.
- `EmergencyOverrideDialog` now captures:
  - A photo (device camera, up to 5 MB) rendered as a base64 data URL.
  - Live geolocation (`getCurrentPosition`, high-accuracy, best-effort).
  - Optional note (unchanged).
- `emergencyOverrideJobStatus` extended to persist the full audit set:
  from/to status, reason, note, driver-reported GPS + accuracy,
  reverse-geocoded street address, latest telemetry speed, snapshotted
  vehicle label (make / plate) and current pax count, and — when a photo
  is provided — a signed URL to a private `override-photos` object.

### Safety-Concern / Breakdown workflows
- Overriding with `safety_concern` stamps `jobs.safety_flag_at`.
- Overriding with `breakdown` stamps `jobs.breakdown_flag_at`.
- Coordinator's TripDetailsSheet renders a red destructive badge for each
  active flag with a Clear action (server fn `clearJobSafetyFlags`, scoped
  to the coordinator's own company / executor company).

## Files added / modified

- `src/lib/emergency-override.ts` — new reasons.
- `src/hooks/use-safety-mode.ts` — enabled + unlock-until inputs.
- `src/components/driver/SafetyModeOverlay.tsx` — Unlock 30s button.
- `src/components/driver/EmergencyOverrideDialog.tsx` — photo + geolocation
  capture, richer confirmation preview.
- `src/lib/coordinator-public.functions.ts` — richer override handler,
  photo upload to `override-photos`, reverse-geocode, pax count, vehicle
  snapshot, safety/breakdown flags, company settings in the manifest.
- `src/lib/coordinator.functions.ts` — `clearJobSafetyFlags` server fn.
- `src/components/coordinator/TripDetailsSheet.tsx` — safety / breakdown
  flag badges with Clear action.
- `src/routes/m.driver.$token.tsx` — wires company settings + unlock into
  Safety Mode.

## Database changes

- `companies.safety_mode_enabled boolean not null default true`
- `companies.safety_mode_allow_override boolean not null default true`
- `job_emergency_overrides` gained `photo_url text`, `photo_path text`,
  `gps_lat/lng double precision`, `gps_accuracy_m double precision`,
  `street_address text`, `vehicle_label text`, `pax_count integer`.
- `jobs.safety_flag_at timestamptz`, `jobs.breakdown_flag_at timestamptz`.
- New private storage bucket `override-photos` with read/write policies
  scoped to the trip's company folder.
- Backfilled missing Phase-1/Batch-A schema that was absent from this
  environment (`companies.arrival_radius_m`, waiting-policy columns,
  `job_wait_proposals`, `job_boarding_approvals`) so already-shipped code
  compiles against the generated types.

## Security

- Fixed `portal_logos_insert_policy_broken_check`: the INSERT policy on
  `storage.objects` for `portal-logos` was checking `split_part(pc.name,'/',1)`
  against `pc.id`, which was effectively always true for any portal the
  coordinator owned. Rewritten to compare `split_part(objects.name,'/',1)`
  against `pc.id::text`, so a coordinator can only upload into their own
  portal folder.

## Not in scope (unchanged)

Phase 1 GPS validation, Batch A waiting / boarding / no-show / cancellation
flows, coordinator override buttons, and driver's 5-minute manual override —
all untouched.
