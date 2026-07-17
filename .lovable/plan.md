## Problem

When a driver receives a grouped trip and taps Accept / On the way / Arrived / In progress on one leg, the sibling legs in the same `group_id` stay behind. The driver ends up tapping the same button 2–3 times per group, and the coordinator sees inconsistent statuses across siblings that are supposed to move together.

Root cause: `driverAcceptJob` and `updateJobStatus` in `src/lib/coordinator-public.functions.ts` update only the single `job_id` passed in. Nothing fans out to `group_id` siblings assigned to the same driver.

## Fix

### 1. Cascade helper (server)

Add an internal helper in `src/lib/coordinator-public.functions.ts`:

```
getGroupSiblingIds(supabaseAdmin, job, { requireSameDriver: true }) → string[]
```

Returns `[job.id]` when no `group_id`, otherwise all sibling job ids in the same `group_id` that are assigned to the same `driver_id` and are still actionable (not `completed` / `cancelled`). Same-driver filter avoids touching a leg a coordinator manually re-assigned to someone else.

### 2. `driverAcceptJob` — accept the whole group

- Load siblings via helper.
- `UPDATE jobs SET driver_accepted_at = coalesce(driver_accepted_at, now()) WHERE id = ANY(ids)`.
- Post the "✅ Driver accepted this trip" system chat message once per newly-accepted sibling (skip legs already accepted).
- Recall this driver's open price proposals on every sibling, not just the tapped one.

### 3. `updateJobStatus` — cascade lifecycle transitions

For the transitions that logically apply to the whole run — `en_route`, `arrived`, `in_progress`, and the `pending` correction — fan out to sibling ids that are currently in a compatible earlier state. `completed` stays per-leg (each drop-off finishes independently); the existing auto-dissolve already handles the "all siblings done" case.

Per cascaded sibling:
- Apply the same `patch` (status, `driver_started_at` on first `en_route`, timestamps).
- Run the arrival GPS advisory only against the tapped leg's pickup — siblings share the same pickup in a merged group; if a sibling has a different pickup, skip cascading `arrived`/`in_progress` for that sibling (still cascade `en_route`).
- Insert matching `trip_map_events` (`en_route`, `back_to_waiting`, arrival override) so the coordinator map shows one pin per leg, tagged with `meta.cascaded_from = tappedJobId`.
- Start/stop `job_wait_sessions` per sibling using the same `max(now, pickup_at)` anchor already used for the tapped leg.
- Boarding-gate check for `in_progress` runs per sibling; if any sibling needs partial-boarding approval, throw once and don't apply that sibling's transition (others still proceed).

### 4. Driver UI — treat a group as one card

In `src/routes/m.driver.$token.tsx`:

- The manifest already lists one row per job. Collapse rows sharing `group_id` + same driver into a single card (reuse the existing `GroupedRunRow` visuals) so the driver sees Stop 1 of N with one primary CTA.
- Primary CTA calls `updateJobStatus` with the current leg's `job_id`; the server cascade above updates the rest. After the tap, invalidate the manifest query so all siblings refresh together (already wired via existing realtime + query invalidation).
- Hide the per-leg Accept button when the group is already accepted; show a single "Accept run" button that calls `driverAcceptJob` on any one leg (server accepts all).
- Keep leg-level controls (Boarded / No-show / Complete this stop) inside the expanded leg detail — those stay per-leg.

### 5. No schema changes

All fields (`group_id`, `driver_id`, `driver_accepted_at`, `driver_started_at`, `status`, `trip_map_events`, `job_wait_sessions`) already exist.

## Verification

1. Create a group of 3 trips, assign to one driver.
2. Driver taps **Accept run** → all 3 legs get `driver_accepted_at`, one system message per leg lands in coordinator chat.
3. Driver taps **On the way** on leg 1 → all 3 flip to `en_route`, `driver_started_at` set, one map pin per leg.
4. Driver taps **Arrived** at the shared pickup → all 3 flip to `arrived`, wait sessions open per leg anchored to `max(now, pickup_at)`.
5. Driver taps **Start trip** → all 3 flip to `in_progress`, wait sessions close.
6. Driver taps **Complete stop** on leg 1 → only leg 1 becomes `completed`; legs 2/3 remain `in_progress`. When the last leg is completed, group auto-dissolves as today.
7. If the coordinator reassigns leg 2 to a different driver before the tap, the cascade skips it (same-driver filter).

## Out of scope

- Cross-group cascades, split-flow (`splitPaxToNewJob`), and coordinator-initiated status overrides (they already touch single legs by design).
- Any change to grouped-run display order — `buildStopChainFromStops` still owns the from/to labeling.
