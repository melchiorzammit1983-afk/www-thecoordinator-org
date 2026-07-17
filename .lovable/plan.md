## Problem

`cloneJob` and `splitJob` in `src/lib/coordinator.functions.ts` (lines 1022–1107) currently copy only ~10 columns from the source job:

`from_location, to_location, date, time, pickup_at, flightorship, clientcompanyname, vehicle`

Everything else is dropped, so on the new card the coordinator/driver see empty passenger name, no phone, no room, no pax count, no addresses with business names, no price/notes/flight info. The client tracking link also fails because:

- No `pax` rows are copied → nothing for the client portal to attach to.
- No client link token is minted (`client_link_token` / `client_link_identities`) → the shareable `/t/<token>` URL doesn't resolve for the split/cloned trip.

`splitPaxToNewJob` (line 2369) already does this correctly for the pax-split flow and is the reference pattern.

## Fix

### 1. `cloneJob` — copy the full trip payload

Extend the `insert(...)` payload to mirror every user-authored field from the source job:

- Contact / passenger header: `name`, `surname`, `contact_phone`, `room_number`, `pax_count`, `notes`, `promo_note`
- Addresses & geo (so business names + map pins render): `pickup_display_name`, `dropoff_display_name`, `pickup_place_id`, `dropoff_place_id`, `pickup_lat`, `pickup_lng`, `dropoff_lat`, `dropoff_lng`, `from_lat`, `from_lng`, `to_lat`, `to_lng`
- Flight info: `from_flight`, `to_flight`
- Pricing: `price_eur`, `currency`, `payment_status` (reset to `pending`)
- Labels: copy rows from `job_labels` for the new job id

Keep the existing reset of `driver_id: null`, `qr_strict_mode: false`, `tracking_enabled: false`, and force new `status: 'pending'`, `coord_approved_at: now()`, clear `driver_accepted_at`, `group_id`, `parent_job_id`, `client_confirmed_at`, `deletion_requested_at`. Update `date/time/pickup_at` to `target_date`.

After insert:
- Copy `pax` rows (`name`, seat/order, notes) to the new `job_id` with fresh ids and `status='pending'`.
- Mint a new `client_link_token` on the row and insert matching `client_link_identities` (mirror the pattern used in `splitPaxToNewJob` around lines 2390–2490) so a `/t/<token>` share link works for the clone.

### 2. `splitJob` — same full copy, one row per split label

Apply the identical payload copy for each split. Per split:
- Suffix `clientcompanyname` (or a new `group_note`) with the split label as today.
- Divide `pax_count` proportionally if provided, else leave equal to source.
- Do **not** copy `pax` rows into every split (splitJob is a label-based split, not a pax move — that's what `splitPaxToNewJob` is for). Instead leave `pax` empty on children so the coordinator can drag pax into them via the existing Manage Pax dialog.
- Mint a fresh `client_link_token` per child and add `client_link_identities` scoped to that child so any client the coordinator shares the link with sees only their split.
- Set `parent_job_id = src.id` on each child so the audit chain and portal grouping already in `splitPaxToNewJob` continue to work.

### 3. Shared helper

Extract the "buildable clone payload" into a small internal helper `buildClonedJobPayload(src, overrides)` inside the same file so `cloneJob`, `splitJob`, and future duplicators stay in sync.

### 4. Client-side surfaces (no logic change, verify only)

- `TripDetailsSheet` and calendar cards already read `name/surname/pax/pickup_display_name/…`, so once the columns are populated the info renders automatically.
- `/t/$token` (`src/routes/api/public/track/$token/index.ts` and `src/routes/t.$token.tsx`) already resolves via `client_link_token` + `client_link_identities`; minting the token in step 1–2 is what makes the link work.

## Out of scope

- Grouped-run cascade (separate feature).
- The pax-split flow (`splitPaxToNewJob`) — already correct.
- No schema changes required; all target columns already exist on `jobs`, `pax`, `client_link_identities`.

## Verification

1. Create a trip with pax names, phone, room, flight, addresses w/ business names, price, and a client link.
2. **Clone** to another date → open the clone: name/surname, pax list, addresses (with business names), flight, price all present; `/t/<new-token>` opens the clone in the client app.
3. **Split** into 2 labels → both children show all trip info (same addresses/flight), each has its own working client link; parent still visible with `parent_job_id` back-references.
4. Coordinator calendar and driver manifest show the full header (no more "Unnamed passenger").