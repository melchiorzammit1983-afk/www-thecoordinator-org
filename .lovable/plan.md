## Collapse same-location runs into a single trip card

When a grouped run's jobs all share the same pickup AND the same dropoff (e.g. Medserv Operations Ltd → Sand Dune Hotel, x2 pax), render it like a normal single trip instead of a numbered multi-stop list.

### Detection (in `src/components/driver/RunCard.tsx`)

Add a `sameLocation` derived flag:
- All jobs in the run have identical `from_location` (case-insensitive trim)
- All jobs have identical `to_location`
- Fallback to `pickup_display_name` / `dropoff_display_name` if raw location is missing

### Rendering when `sameLocation === true`

- Header: single `From → To` using the shared pickup/dropoff (no "Stop 1 of N" pointer).
- Badge: keep "Run" pill, but subtitle becomes `{groupName} · {totalPax} pax` (sum `pax.length` across all jobs). Drop the "N stops" wording.
- Navigate button: exactly one button, same behavior as a standalone JobCard — destination = pickup while `pending`/`en_route`, flips to dropoff once `in_progress`.
- Action buttons: unchanged labels but without the "at stop N" / "stop N" suffix — plain "Arrived", "Start trip", "Complete trip". Each action fans out to every job in the run (reuse existing `Promise.all` fan-out already used for "On the way").
- Stop list `<ol>`: hidden. Replace footer hint with a compact passenger list (names from each job, comma-separated) so the driver still sees who's on board.
- Safety mode: same collapse — show shared dropoff as the big label, single Navigate + single status button that fans out.

### Rendering when `sameLocation === false`

Unchanged — current multi-stop UI with numbered chips, chain-reflow legs, per-stop advance.

### Status fan-out helper

Extract the existing "On the way" fan-out pattern into a small local helper so "Arrived", "Start trip", and "Complete trip" can reuse it in the collapsed variant. Per-stop `advanceMut` stays for the multi-stop path.

### Out of scope

- No coordinator-side changes.
- No changes to `use-driver-runs.ts` bucketing (still one run per group_id).
- No changes to `use-auto-next-job.ts` — mid-run suppression still applies.
- No DB or server function changes.

### Files touched

- `src/components/driver/RunCard.tsx` — add `sameLocation` branch, shared fan-out helper, passenger summary line.