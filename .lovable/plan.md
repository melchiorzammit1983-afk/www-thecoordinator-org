## Auto-Refresh Button on Dispatch Board

Add a toggle button in the Dispatch Calendar header that, when enabled, runs a full "sweep" every 60 seconds and shows a live indicator.

### What the sweep does (per tick)
For every visible trip in the current calendar view:
1. **Normalize data** — run `normalizeJobData` on each job (moves phone numbers out of pax names into the phone field, moves flight codes out of from/to into the flight field, deletes blank/emoji-only pax rows).
2. **Refresh flight tracking** — call `refreshMaltaFlightForJob` for any job with a `flight_number`, updating scheduled/estimated times and the `time_mismatch` flag (red rim).
3. **Refresh driver tracking** — invalidate the `driver_locations` query so the live map markers re-pull latest GPS pings.
4. **Refresh passenger confirmations / statuses** — invalidate the jobs, pax, dispatch-hops, and driver-status queries so accepted/pending/on-the-way states repaint (green/orange/red).

### UI
- New `AutoRefreshToggle` component in the calendar toolbar (next to search/filters).
- States: **Off** (default, outline), **On** (solid teal with pulsing dot + "Auto-refresh · every 1 min · next in 42s" countdown).
- Manual "Refresh now" icon runs one sweep immediately without toggling the timer.
- Persists per-user in `localStorage` (`dispatch:autoRefresh`) so it stays on across reloads.
- Toast on first enable: "Auto-refresh on — cleaning data and refreshing flights every minute."
- Small footer line under the toggle shows last sweep result: "Cleaned 3 trips · refreshed 5 flights · 12:04:31".

### Throttling & safety
- Sweep runs sequentially with a small concurrency limit (e.g. 4 in parallel) to avoid hammering Firecrawl/AviationStack.
- Skips jobs older than 24h past pickup and cancelled jobs.
- Auto-pauses when the tab is hidden (`document.visibilityState`) and resumes on focus.
- Errors per-job are swallowed and counted, not thrown — one bad job doesn't stop the sweep.

### Files touched
- `src/components/coordinator/AutoRefreshToggle.tsx` (new) — button, timer, countdown, localStorage.
- `src/lib/coordinator.functions.ts` — small `sweepJobs({ jobIds })` server fn wrapping normalize + flight refresh per job, returning `{ cleaned, flightsRefreshed, errors }`.
- `src/routes/coordinator/calendar.tsx` — mount toggle in toolbar; on each tick collect visible job IDs, call `sweepJobs`, then invalidate `["jobs"]`, `["job-pax"]`, `["driver-locations"]`, `["dispatch-hops"]`, `["driver-status"]` query keys.

No schema changes. No changes to how trips are created or displayed — only a scheduled repetition of existing cleanup + refresh actions.