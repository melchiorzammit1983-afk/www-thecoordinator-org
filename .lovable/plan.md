# Driver app: flashing active card + auto-stop tracking on finish

Two small changes on the driver-side manifest (`/m/driver/:token`).

## 1. Flash the trip card while it's in progress

On the driver's trip card in `src/routes/m.driver.$token.tsx` (the block that starts around line 400 and shows the colored-stripe header + `TripProgress`), add a subtle pulsing highlight when `job.status === "in_progress"` so the driver instantly sees which trip has passengers on board.

- Add a new keyframe `trip-flash` in `src/styles.css` — a slow 1.6s pulse that fades the card's ring/border between the brand accent and transparent. Kept subtle (no full-card background flash) so it doesn't fight the existing colored stripe.
- Expose it as a utility class `.animate-trip-flash`.
- On the card wrapper, conditionally apply `animate-trip-flash ring-2 ring-primary/60` when `job.status === "in_progress"`.
- Also add a small "In progress" pill next to the existing status badge (line ~455) so the state is readable, not only felt.

No behavior change for other statuses.

## 2. Stop live tracking the moment the trip is finished

Currently `DriverLiveShare` auto-*starts* when `hasActiveTrip` becomes true, but never auto-*stops* when it becomes false, so GPS keeps broadcasting after the driver marks the trip completed. The client-live query is already correctly gated by `job.status !== "completed"`, so only the driver-broadcast side needs fixing.

In `src/components/driver/DriverLiveShare.tsx`:

- Change the auto-start effect (lines 117–119) to also auto-stop:
  ```ts
  useEffect(() => {
    if (hasActiveTrip && !enabled) setEnabled(true);
    else if (!hasActiveTrip && enabled) setEnabled(false);
  }, [hasActiveTrip, enabled]);
  ```
- The existing teardown branch in the `enabled` effect (lines 123–140+) already clears the web `watchPosition`, releases the wake lock, and removes the native `BackgroundGeolocation` watcher, so flipping `enabled` to false is enough to fully stop GPS.
- Also clear the persisted "keep tracking on next launch" flag when we auto-stop, so reopening the manifest after a completed trip doesn't immediately turn tracking back on.

In `src/routes/m.driver.$token.tsx` (line 198), `hasActiveTrip` already excludes `completed`, so as soon as the driver taps "Trip finished" and the mutation invalidates the manifest query, `hasActiveTrip` flips to false and tracking stops within one refetch cycle. No extra plumbing needed.

## Files touched

- `src/styles.css` — add `trip-flash` keyframe + `.animate-trip-flash` utility.
- `src/routes/m.driver.$token.tsx` — apply flashing classes + "In progress" pill on the active card.
- `src/components/driver/DriverLiveShare.tsx` — auto-stop when `hasActiveTrip` goes false, clear persisted flag.

## Out of scope

- The driver-chat passenger picker (already works for >1 pax on the Client tab).
- Any coordinator-side card styling.
- Changing the trip status flow or the "Trip finished" summary dialog.
