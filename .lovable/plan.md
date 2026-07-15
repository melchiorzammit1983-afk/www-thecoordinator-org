
# Batch B — Delta Plan (Safety Mode + Emergency Override)

## Context: what already ships

Batch B was largely delivered in Phases 4 & 5 (see `docs/PHASE_4_COMPLETED.md`, `docs/PHASE_5_COMPLETED.md`):

- `companies.safety_mode_threshold_kmh` (default 10, configurable)
- `useSafetyMode` hook (10 km/h derivation, 30 s stale reset, normalizes iOS `-1`)
- `SafetyModeOverlay` banner
- `DriverLiveShare` pushes `speed_mps`; manifest hides distracting actions in Safety Mode
- `job_emergency_overrides` table (job_id, driver_id, company_id, action, reason, reason_note, from_status, to_status, speed_mps, created_at) + RLS
- `EmergencyOverrideDialog` with 5 actions (force_arrived / force_pob / force_en_route / force_drop_off / force_complete) and 7 reasons
- Server fn `emergencyOverrideJobStatus` — closes wait sessions, overrides boarding approvals, posts coordinator system chat, writes audit row

This plan will NOT touch the accepted → arrived → waiting → boarding → en_route → completed workflow. Existing Safety Mode threshold, hook, overlay, and override server fn remain the source of truth.

## Gaps vs the new Batch B spec

| Spec item | Status | Action |
|---|---|---|
| Safety Mode `enabled` toggle | ❌ | add column + gate hook |
| Safety Mode `allow_override` | ❌ | add column + driver "temporarily unlock" button |
| Reason: **Road Closure** | ❌ | add to enum + labels |
| Reason: **Passenger Already On Board** | ❌ | add to enum + labels |
| Notes on override | ✅ | already `reason_note` |
| Photo attachment | ❌ | new `override-photos` bucket + upload + `photo_url` column |
| Audit: `gps_accuracy` | ❌ | add column, capture from last `driver_locations` |
| Audit: `street_address` | ❌ | add column, reverse-geocode server-side |
| Audit: `vehicle_id` | ⚠️ | column not needed — drivers table has vehicle; store snapshot as `vehicle_label` |
| Audit: `approval_status` | ❌ | add column default `auto_approved` |
| Safety Concern workflow (pause trip, highlight, notify) | ⚠️ partial (system chat only) | flag `jobs.safety_flag_at`, coordinator badge |
| Breakdown workflow (save pax count, allow reassignment) | ⚠️ partial | flag `jobs.breakdown_flag_at`, unassign driver optionally, coordinator badge |
| Coordinator highlight of overridden trips | ❌ | render badge on TripDetailsSheet / calendar card |
| `docs/BATCH_B_IMPLEMENTATION.md` | ❌ | create alongside existing COMPLETED docs |

## Affected files

**Database (new migration `supabase/migrations/<ts>_batch_b_delta.sql`)**
- `ALTER companies` — add `safety_mode_enabled bool default true`, `safety_mode_allow_override bool default true`
- `ALTER job_emergency_overrides` — add `photo_url text`, `gps_accuracy_m numeric`, `street_address text`, `vehicle_label text`, `approval_status text default 'auto_approved' check in (auto_approved, pending_review, reviewed)`, `pax_count int`
- Update `job_emergency_overrides_reason_check` to include `road_closure`, `passenger_already_on_board`
- `ALTER jobs` — add `safety_flag_at timestamptz`, `safety_flag_note text`, `breakdown_flag_at timestamptz`, `breakdown_flag_note text`
- New storage bucket `override-photos` (private) via `supabase--storage_create_bucket` + `storage.objects` policies scoped by `company_id/{job_id}/*`

**Backend**
- `src/lib/emergency-override.ts` — add two reasons + labels; export ordered list matching spec
- `src/lib/coordinator-public.functions.ts` — `emergencyOverrideJobStatus`:
  - accept `photo_url`, `gps_accuracy_m`, `pax_count`
  - read latest `driver_locations` row for accuracy + reverse-geocode street address (via existing places server helper — reuse `reverseGeocode` pattern from `places.functions`)
  - snapshot `drivers.vehicle_make || plate` into `vehicle_label`
  - on `safety_concern` reason → set `jobs.safety_flag_at`, `safety_flag_note`
  - on `breakdown` reason → set `jobs.breakdown_flag_at`, `breakdown_flag_note`, save `pax_count`
  - honour `companies.safety_mode_enabled` when returning manifest settings

**Driver UI (`src/routes/m.driver.$token.tsx`, `EmergencyOverrideDialog.tsx`)**
- Add optional photo picker (single image, ≤ 5 MB, uploaded to `override-photos/{company}/{job}/{uuid}.jpg` before submit)
- Add "Unlock 30 s" button on `SafetyModeOverlay` when `safety_mode_allow_override` is true (temporary bypass by disabling `isSafetyMode` locally with a 30 s timer)
- Gate Safety Mode activation on `safety_mode_enabled`
- Extend reason list to 9 items in the shown order

**Coordinator UI**
- `TripDetailsSheet.tsx` — badge "Safety concern" / "Breakdown" when the corresponding flag column is set, with reason note; button "Clear flag" (server fn `clearJobFlag`) and "Reassign driver" (existing driver reassignment path) for breakdowns
- Calendar `JobCard` — subtle red left-border when either flag is set (reuse urgency-glow slot)

**Points billing**
- No new billable feature (overrides are safety/compliance — not points-metered)

## Docs deliverables

- `docs/BATCH_B_IMPLEMENTATION.md` — the pre-code plan (this file, expanded)
- `docs/BATCH_B_COMPLETED.md` — post-code summary with modified files, DB diff, API diff, driver + coordinator UI notes, testing checklist, risks, rollback SQL

## Testing checklist (manual)

1. Admin toggles `safety_mode_enabled = false` on a company → banner never appears even above 10 km/h
2. `allow_override = true` → "Unlock 30 s" button restores hidden buttons for 30 s, then re-locks
3. Trigger override with Road Closure & Passenger Already On Board — both saved
4. Upload photo → visible in `override-photos` bucket, `photo_url` persisted
5. Safety Concern reason → `jobs.safety_flag_at` set, coordinator sees red badge; "Clear flag" removes it
6. Breakdown reason → `jobs.breakdown_flag_at` set, `pax_count` saved; coordinator can reassign driver
7. Audit row includes `gps_accuracy_m`, `street_address`, `vehicle_label`, `approval_status='auto_approved'`
8. Existing Phase 4/5 behaviour (30 s stale reset, backward-transition chat, wait-session close) still passes

## Risks

- Reverse geocode call inside the override handler adds latency; mitigate by fire-and-forget update after insert
- Storage bucket policy must scope to `company_id` prefix — regression risk if driver token lacks company scope; reuse existing `company_of(auth.uid())` helper pattern (drivers hit endpoint via token, so store via server fn using service role)
- Enum widening on `reason_check` requires drop+recreate constraint

## Rollback

- Drop added columns on `jobs`, `job_emergency_overrides`, `companies`
- Restore original `reason_check`
- Delete `override-photos` bucket
- Revert `emergency-override.ts` and `EmergencyOverrideDialog.tsx`

