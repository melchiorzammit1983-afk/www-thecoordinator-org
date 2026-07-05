# Stop All Live Tracking When Trip Completes

## Problem

When a driver marks a trip **completed** (or the coordinator cancels it):

1. **Driver side** — `DriverLiveShare` already unmounts because `hasActiveTrip` only includes `en_route | arrived | in_progress`. ✅ Already correct.
2. **Coordinator dashboard** — `listActiveDriverLocations` returns the latest `driver_locations` row for any job assigned to the company within the last 30 min. It does **not** filter by job status, so a just-completed trip keeps a stale driver pin/ETA/next-instruction on the coordinator's map for up to 30 min.
3. **Client portal** — `ShareLocation` on `t.$token.tsx` is a manual toggle. If the passenger left "Share live" on, the browser keeps posting `pushClientLocation` after the trip is over. `pushClientLocation` accepts the write regardless of job status, and `getClientLiveLocationDriver` returns the last 3 min of client points.
4. **Driver's view of client live pin** — `getClientLiveLocationDriver` doesn't check job status either.

## Fix

Two-layer defense: (a) client-side auto-stop when the job status is terminal, (b) server-side refusal so stale watchers can't leak points.

### 1. `src/lib/coordinator.functions.ts` — `listActiveDriverLocations`
Add a status filter: only include jobs with `status IN ('en_route','arrived','in_progress')`. Completed / cancelled / accepted-but-not-started jobs disappear from the coordinator's live map immediately.

### 2. `src/lib/coordinator-public.functions.ts`
- **`pushClientLocation`**: after `loadJobByClientToken`, if `job.status ∈ ('completed','cancelled')`, return `{ ok: true, inserted: 0, reason: 'trip_ended' }` (no insert). Prevents stale watchers from writing new rows.
- **`getClientLiveLocationDriver`**: return `null` when `job.status ∈ ('completed','cancelled')`, in addition to the 3-min freshness gate.
- **`pushDriverLocation`**: tighten the fallback so the driver's watcher can't post after a trip completes — remove the "next assigned job" fallback and only accept pings when there's an active job in `('en_route','arrived','in_progress')`. Return `{ ok:true, inserted:0, reason:'no_active_trip' }` otherwise. (The driver client already stops the watcher; this closes a small race.)

### 3. `src/routes/t.$token.tsx` — `ShareLocation`
- Accept the `status` from the parent portal payload.
- Add a `useEffect` that watches `status` and, when it becomes `completed` or `cancelled`, calls `navigator.geolocation.clearWatch`, resets `sharing`, and shows a toast: `Trip ended — live sharing stopped`.
- Disable the "Share live" / "Send my pin" buttons once the trip is terminal.

### 4. `src/components/coordinator/TripDetailsSheet.tsx` (defensive)
The live-map hook already uses `listActiveDriverLocations`; after the server-side filter above, the last driver pin, ETA chip, and next-instruction disappear on the next poll (≤ ~8 s). No new client code needed here — just verify by opening a completed trip.

## Out of scope

- Deleting historical `driver_locations` / `client_locations` rows. Those stay for audit / replay. Only *live* display is gated.
- Client-side "pin" (single-shot) drops when trip is done — server refusal above already blocks new ones; no need to hide historical chat messages.

## Files Changed

- `src/lib/coordinator.functions.ts`
- `src/lib/coordinator-public.functions.ts`
- `src/routes/t.$token.tsx`

No migrations, no new tables.
