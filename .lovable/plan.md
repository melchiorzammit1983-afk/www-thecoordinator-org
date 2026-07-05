## Goal

Keep the driver's screen awake for the full duration of a live trip so the always-on map stays visible while they drive.

## Approach

Add a small `useWakeLock` hook that requests `navigator.wakeLock.request('screen')` whenever a driver has an active in-motion trip, and releases it when the trip finishes, the tab goes to background, or the component unmounts.

Trip is considered "in motion" (wake-lock ON) when the active job's status is `en_route`, `arrived`, or `in_progress` — i.e. from the moment the driver taps "On the way to pickup" until they tap "Trip finished". This maps exactly to the user's "Start Trip → Complete Trip" window and reuses the `inMotion` flag we already compute in `src/routes/m.driver.$token.tsx`.

## Behaviour

- Request the lock when `inMotion` becomes true.
- Release the lock (and clear our reference) when `inMotion` becomes false, when the driver closes the window, or when the manifest unmounts.
- Re-acquire the lock automatically after `visibilitychange` returns to visible — the browser drops screen wake locks whenever the tab hides, per spec.
- Fail silently on unsupported browsers (older iOS Safari) and on `NotAllowedError`; no toast spam.
- Show a subtle "Screen kept awake" indicator in the header while the lock is held, so the driver knows why their phone isn't dimming.

## Files

- **New:** `src/hooks/use-wake-lock.ts` — `useWakeLock(active: boolean): { supported: boolean; held: boolean }` hook encapsulating request/release/visibility-rebind logic.
- **Edit:** `src/routes/m.driver.$token.tsx` — call `useWakeLock(inMotion)` inside `DriverManifest` and render a tiny "Screen awake" pill in the header while `held` is true.

## Technical notes

- `navigator.wakeLock` is only available in secure contexts (HTTPS or localhost). The driver dashboard is served over HTTPS in preview and prod, so this is fine.
- The Wake Lock Sentinel is auto-released when the page is hidden; the hook listens for `document.visibilitychange` and re-requests when the page becomes visible again while `active` is still true.
- No third-party dependency, no background worker, no changes to the map or routing code.
- No SSR concern — the hook only touches `navigator` inside `useEffect`.
