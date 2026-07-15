# Phase 4 — Driver Safety Mode

## What changed
- Added company-level `safety_mode_threshold_kmh` configuration with a default of `10`.
- Added client-side Safety Mode derivation from live GPS speed with normalization for invalid/non-positive speeds.
- Added a 30-second stale-speed reset so Safety Mode fails open when speed updates stop.
- Added a fixed Safety Mode banner in the driver manifest.
- Hid distracting driver actions in Safety Mode, including the overflow menu, running-late, give-back, back-to-waiting, mark paid/pending, hide/restore, and billing panels.
- Kept navigation, passenger access, status progression, trip details, chat, and emergency actions available.

## Files modified
- `/home/runner/work/www-thecoordinator-org/www-thecoordinator-org/supabase/migrations/20260710133500_batch_b_safety_and_emergency_override.sql`
- `/home/runner/work/www-thecoordinator-org/www-thecoordinator-org/src/components/driver/DriverLiveShare.tsx`
- `/home/runner/work/www-thecoordinator-org/www-thecoordinator-org/src/components/driver/SafetyModeOverlay.tsx`
- `/home/runner/work/www-thecoordinator-org/www-thecoordinator-org/src/hooks/use-safety-mode.ts`
- `/home/runner/work/www-thecoordinator-org/www-thecoordinator-org/src/lib/coordinator-public.functions.ts`
- `/home/runner/work/www-thecoordinator-org/www-thecoordinator-org/src/routes/m.driver.$token.tsx`
- `/home/runner/work/www-thecoordinator-org/www-thecoordinator-org/src/integrations/supabase/types.ts`

## Database changes
- Added `companies.safety_mode_threshold_kmh integer not null default 10`.
- Added constraint `companies_safety_mode_threshold_kmh_check` enforcing `1..200`.

## API changes
- `getDriverManifest` now returns `companySettings.safety_mode_threshold_kmh`.
- `DriverLiveShare` now accepts `onSpeedChange?: (speedMps: number | null) => void`.

## Testing steps
- Apply the new migration.
- Open a driver manifest with an active accepted trip.
- Confirm Safety Mode activates when GPS speed reaches at least `10 km/h`.
- Confirm invalid iOS-style speed values (`-1`) and missing speed values do not activate Safety Mode.
- Confirm Safety Mode clears after speed falls below threshold.
- Confirm Safety Mode also clears after roughly 30 seconds without fresh speed updates.
- Confirm Navigation, passenger access, chat, trip details, and status progression remain usable.
- Confirm running-late, give-back, back-to-waiting, payment toggles, hide/restore, and the overflow menu are hidden while Safety Mode is active.

## Known issues
- Repository lint/build dependency installation is blocked in this environment because `cdn.sheetjs.com` is unreachable.
- `docs/TRANS_DESK_COPILOT_PLAN.md` and `docs/TRANS_DESK_MASTER_GUIDE.md` were not present in the repository, so implementation followed the available Batch B documents.

## Rollback steps
- Revert `/home/runner/work/www-thecoordinator-org/www-thecoordinator-org/supabase/migrations/20260710133500_batch_b_safety_and_emergency_override.sql`.
- Remove `SafetyModeOverlay` and `use-safety-mode`.
- Remove `DriverLiveShare.onSpeedChange` wiring and Safety Mode manifest logic.
- Remove `companySettings.safety_mode_threshold_kmh` from the manifest payload and local types.
