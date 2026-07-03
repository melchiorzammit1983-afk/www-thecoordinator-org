## Goal

When a partner splits a dispatched trip into 2+ vehicles, the creator's partner lane must show **one complete card per split child** (pax names, flight info, phone, labels, group, coord approval), each with its own chat and its own client portal link, so the coordinator can talk to the right client/driver for each split.

## Changes

### 1. `splitPaxToNewJob` — copy full trip context to each child (`src/lib/coordinator.functions.ts`)

Beyond what's already copied, when a partner-executor splits a dispatched trip, the new child job also inherits from the parent:

- Flight: `from_flight`, `to_flight`, `flight_status`, `flight_status_note`, `flight_status_updated_at`, `flight_scheduled_at`, `flight_estimated_at`
- Contact: `contact_phone`
- Grouping: `group_id`, `group_name`, `group_note`, `grouped_count`, `grouped_at`
- Approval/source: `coord_approved_at`, `source`
- Client portal: **mint a fresh `client_link_token`** for the child (per-pax split → each child gets its own link; the moved passengers only see their own split)
- Labels: copy `job_labels` rows from parent → child

Non-partner split (owner splitting their own trip) keeps today's behavior plus the same field copy so the split card is complete on the owner side too.

### 2. Client portal — moved pax follow their split

- On split, if any moved pax has a `client_link_identities` row bound to the parent job's token, rebind those identities to the new child's token so the client's link resolves to the split they're actually on.
- Send an updated portal link to the moved pax's client contact (reuse the existing notification code path used when trips are created; if there isn't one for this case, add a lightweight `notify_client_of_split` call).

### 3. Chat — separate thread per child, creator can post in all

- No schema change: `trip_messages` is already scoped by `job_id`, so children already have their own thread.
- Confirm `TripChatDialog` opens for `chain_role === "creator_watching"` split-child cards and that the creator's post permission on `trip_messages` covers `company_id = creator` OR `origin_company_id = creator`. Add the missing policy branch if not.

### 4. Creator's partner lane rendering (`coordinator.calendar.tsx`)

- Filter already covers both parent and split children (`chain.includes(partner) || executor === partner`). Verify the split child has `chain_role = "creator_watching"` in `listJobs` (it does, because `executor_company_id ≠ creator`).
- Ensure the parent card doesn't disappear when all pax have been moved off it — render it as "0 pax · fully split" instead of hiding.
- Each child card shows: pax list, flight badge, contact phone action, chat button, client link, chain timeline dot for the partner that split it.

### 5. Backfill migration

For every existing job that was created via `splitPaxToNewJob` before this fix (has `parent_job_id`, has `executor_company_id ≠ company_id`), copy the missing fields from parent and mint `client_link_token` if null.

## Technical notes

- `client_link_token` generation reuses the same helper used when a trip is first created (or `gen_random_uuid()`-style short token — will match existing scheme).
- `job_labels` copy is a single `INSERT ... SELECT` inside `splitPaxToNewJob` scoped to the source job id.
- No RLS change needed for the parent-lane visibility; creator already sees the child via `company_id = creator`.
- The A→B→C statement chain already reflects splits because step 2 of the prior fix writes a `job_dispatch_hops` row per child.

## Out of scope / to confirm later

- Merging split children back into one card — not requested.
- SMS/email templating for the "your ride was split" notification wording — placeholder text for now; you can rewrite it after seeing it live.

## Open question I still need from you

Is there a specific way you want the **partner to notify you (creator) when they split** — a toast/inbox banner on your board, or is the split child card silently appearing in the partner lane enough? I'll default to "card appears + subtle 'new split' badge for 30s" unless you say otherwise.
