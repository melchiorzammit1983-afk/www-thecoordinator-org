# Auto-fill passenger list

Goal: whenever a trip has `pax_count > 1` and no passenger rows, populate the passenger list automatically from any names we can find, and pad the rest with `Guest N`. Drivers always see the right number of slots to verify.

## How the extractor works

A single helper `extractPaxNames({ clientcompanyname, notes, name, surname, portalPaxNames })` returns a clean, deduped array of names.

Sources it scans, in priority order:

1. **Portal booking payload** — any `pax_names[]` supplied by the hotel/guest portal.
2. **Client/company field** — anything inside parentheses:
   `MV Ocean Pioneer (Michael Harris, Thomas White)` → `["Michael Harris", "Thomas White"]`.
3. **Notes field** — patterns like `Passengers: A, B & C`, `Pax: A / B`, `Guests — A, B`.
4. **Name + Surname** — split combined values like `John Smith & Jane Doe`, `John & Jane`.

Splitting rules: `,`, `;`, `&`, `/`, ` and ` (case-insensitive), newlines. Trim, drop empties, dedupe case-insensitive, cap at 20.

## Padding

Given `names[]` and `pax_count`:

```
result = names.slice(0, pax_count)
while result.length < pax_count: result.push(`Guest ${result.length + 1}`)
```

If `pax_count` is null/1, only the extracted names are used (no padding).

## Where it runs

- **`createJob`** (`src/lib/coordinator.functions.ts`) — after insert, if `data.pax` is empty/undefined and `pax_count > 1`, call the extractor from the just-inserted job fields and pass to `syncJobPax`.
- **`updateJob`** — same treatment when `pax_count` grows or the client/notes fields change, but only if the current pax list is empty. Never overwrite manually-edited rows.
- **`acceptPortalBooking`** (`src/lib/portal.functions.ts`) — already seeds names; refactor to call the shared extractor so notes/client parentheses on portal bookings also feed in.
- **AI extraction path** — the assistant's `toDraft` continues to pass explicit `pax`; extractor only fires when that array is empty.

## Backfill

One-time migration/insert that, for every job with `pax_count > 1` and zero rows in `pax`:

1. Runs the extractor over its `clientcompanyname` + `notes` + `name`/`surname` + linked `portal_bookings.payload.pax_names`.
2. Pads with `Guest N` to reach `pax_count`.
3. Inserts the rows.

Uses a SQL function `public.extract_pax_names(text, text, text, text, text[])` mirroring the TS logic (regex-based) so the backfill is a single SQL statement. New trips still use the TS helper.

## Files touched

- `src/lib/pax-extract.ts` (new) — pure TS extractor + unit-friendly helpers.
- `src/lib/coordinator.functions.ts` — call extractor in `createJob` / `updateJob` before `syncJobPax`.
- `src/lib/portal.functions.ts` — replace inline logic with shared extractor.
- `supabase migration` — `extract_pax_names()` SQL helper + backfill `INSERT … SELECT` for existing trips.

## What we do NOT do

- No overwrite when the pax list already has any row.
- No auto-fill for solo trips (`pax_count <= 1`).
- No AI call — pure regex/string parsing, zero cost.