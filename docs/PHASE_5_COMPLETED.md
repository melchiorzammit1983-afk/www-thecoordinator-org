# Phase 5 — Emergency Override

## What changed
- Added a dedicated `job_emergency_overrides` audit table.
- Added driver Emergency Override actions for Force Arrived, Force Passenger On Board, Force En Route, Force Drop Off, and Force Complete.
- Added required reason capture with the seven approved reasons and optional note capture.
- Recorded override timestamp, driver, trip, company, from-status, to-status, and latest known speed.
- Added coordinator-visible system chat messages for every override.
- Closed open wait sessions on override to `en_route` or `completed`.
- Marked pending boarding approvals as overridden on override to `in_progress`.
- Preserved backward-transition context in coordinator chat when an override moves the trip earlier in the flow.

## Files modified
- `/home/runner/work/www-thecoordinator-org/www-thecoordinator-org/supabase/migrations/20260710133500_batch_b_safety_and_emergency_override.sql`
- `/home/runner/work/www-thecoordinator-org/www-thecoordinator-org/src/components/driver/EmergencyOverrideDialog.tsx`
- `/home/runner/work/www-thecoordinator-org/www-thecoordinator-org/src/lib/emergency-override.ts`
- `/home/runner/work/www-thecoordinator-org/www-thecoordinator-org/src/lib/coordinator-public.functions.ts`
- `/home/runner/work/www-thecoordinator-org/www-thecoordinator-org/src/routes/m.driver.$token.tsx`
- `/home/runner/work/www-thecoordinator-org/www-thecoordinator-org/src/integrations/supabase/types.ts`

## Database changes
- Created `public.job_emergency_overrides`.
- Added indexes on `job_id`, `driver_id`, and `created_at desc`.
- Enabled RLS and added authenticated company-scoped read access.
- Granted `SELECT` to `authenticated` and `ALL` to `service_role`.

## API changes
- Added `emergencyOverrideJobStatus` in `/home/runner/work/www-thecoordinator-org/www-thecoordinator-org/src/lib/coordinator-public.functions.ts`.
- Added shared emergency override action/reason mappings in `/home/runner/work/www-thecoordinator-org/www-thecoordinator-org/src/lib/emergency-override.ts`.

## Testing steps
- Apply the new migration.
- Open an accepted active trip in the driver manifest.
- Launch Emergency Override and verify all reasons are selectable.
- Verify Force Arrived bypasses the normal GPS arrival gate.
- Verify Force Passenger On Board bypasses the boarding gate and marks any pending boarding approval as overridden.
- Verify Force En Route closes any open wait session.
- Verify Force Drop Off and Force Complete both complete the trip and close any open wait session.
- Verify an audit row is written to `job_emergency_overrides`.
- Verify a coordinator-visible `driver_coord` system message is created for each override.
- Verify terminal trips (`completed`, `cancelled`) cannot be overridden.

## Known issues
- Repository lint/build dependency installation is blocked in this environment because `cdn.sheetjs.com` is unreachable.
- End-to-end automated validation could not be completed here because required frontend dependencies are unavailable without network access.

## Rollback steps
- Drop `public.job_emergency_overrides`.
- Remove `emergencyOverrideJobStatus`.
- Remove `EmergencyOverrideDialog` and shared emergency override helpers.
- Remove Emergency Override buttons and dialog wiring from the driver manifest.
