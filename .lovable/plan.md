## Goal
Let a coordinator paste a multi-trip block (WhatsApp-style) into the New Trip dialog. The system parses it into one Job per trip block, creates one Pax row per name, and lists the passengers on the trip card so the dispatcher can split names across drivers.

## Paste format supported
```
📅Wed 01 Jul 2026⏰11:00
👤Names
*🔁 ELMER CLEMENTE AGUINALDO
•🔁 NIXON KALATHILAPARAMBIL VINCENT
...
🏢 rosetti
📍 From: cerviola
📍 To: Airport
```
- New trip starts at each `📅` line.
- Date + time parsed from that line (`Wed 01 Jul 2026` + `11:00`).
- Lines starting with `*`, `•`, `-`, `🔁` (any combination) under `👤Names` become pax names (emojis/bullets stripped, uppercase preserved).
- `🏢` → `clientcompanyname`, `📍 From:` → `from_location`, `📍 To:` → `to_location`, optional `✈`/`🛳` → `flightorship`.
- Blank lines and unknown lines ignored.
- Multiple trip blocks in one paste = multiple jobs created in one submit.

## UI changes — `JobFormDialog`
1. Add tabs at the top: **Manual** (current form) / **Paste bulk**.
2. **Paste bulk** tab:
   - Large `Textarea` for the raw text.
   - Live preview panel below listing detected trips: `From → To · date time · N pax` with expandable name list. Bad blocks show a red note but don't block the good ones.
   - "Create N trips" button — disabled if 0 valid trips parsed.
3. **Manual** tab: add a **Passengers** section — one-name-per-line textarea (optional) so a single trip can also carry a pax list. Existing feature toggles unchanged.
4. On save, jobs are created unassigned (existing default). No premium point charge for adding pax.

## Trip card changes — `TripCard` in `coordinator.calendar.tsx`
- Fetch pax count for each job (extend `listJobs` to return `pax_count` and `pax:[{id,name}]` via nested select).
- Show `👤 N pax` badge on the card.
- Clicking the card (or a new **Passengers** icon button) opens a new **Passengers dialog**:
  - Lists every pax on this job with a checkbox.
  - "Move selected to…" dropdown of drivers (or "New split job"). 
  - Confirm → calls a new server fn `movePaxToDriver({ pax_ids, target_driver_id })` or `splitPaxToNewJob({ job_id, pax_ids, driver_id })`.
- The existing drag-drop of the whole card is unchanged.

## Server functions (`src/lib/coordinator.functions.ts`)
1. `createJobsBulk({ trips: ParsedTrip[] })` — one transaction-ish loop:
   - For each trip: insert job (company scoped, unassigned, status `pending`), then bulk-insert pax rows.
   - Returns created job ids.
2. `listJobs` — extend select to `*, drivers(name), pax(id,name)`.
3. `splitPaxToNewJob({ source_job_id, pax_ids, driver_id? })`:
   - Verify all pax belong to a job in caller's company.
   - Create a new job copying from/to/date/time/pickup_at/flight/client/qr/tracking, `driver_id = driver_id ?? null`.
   - `UPDATE pax SET job_id = <new> WHERE id = ANY(pax_ids)`.
   - If source job ends up with 0 pax, leave it (coordinator can delete manually) — safer default.
4. `movePaxToJob({ pax_ids, target_job_id })` — for moving pax between existing jobs on the same driver/day (optional stretch, cheap to add).

Charging: no `charge_feature` calls in these new fns — parsing/splitting names is free. QR/tracking toggles still charge via existing `updateJob` path.

## Parser
- Pure TS helper `src/lib/parse-trips.ts` exporting `parseTrips(raw: string): ParsedTrip[]`.
- Robust to leading/trailing whitespace, mixed bullets, missing sections (skip trip if no From+To+date+time).
- Unit-testable, no deps.

## Not in scope
- Recurring/schedule interpretation of `🔁` (just an icon marker in the paste — stripped from name).
- Editing pax after creation beyond moving them between jobs/drivers.
- Points cost changes.

## Files touched
- `src/lib/parse-trips.ts` (new)
- `src/lib/coordinator.functions.ts` — add `createJobsBulk`, `splitPaxToNewJob`; extend `listJobs` select
- `src/components/coordinator/JobFormDialog.tsx` — tabs, bulk textarea + preview, passengers textarea
- `src/components/coordinator/PaxSplitDialog.tsx` (new)
- `src/routes/_authenticated/coordinator.calendar.tsx` — pax badge + open PaxSplitDialog on card click
