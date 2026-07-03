## Goal

Make the creator (Coordinator A) always see every partner-forwarded trip on their own dispatch board — one card per partner lane, hop by hop — from the moment it's dispatched, through acceptance, driving, and completion. Dragging a card onto a partner lane opens a confirm dialog and dispatches it.

## What changes for the user

1. **Partner lanes on the dispatch board.** Next to driver lanes, each active connected partner gets its own lane (day and week view). Empty lanes still show so trips can be dropped there.
2. **Drag a trip onto a partner lane → confirm dialog opens** (partner prefilled, optional note) → Dispatch. Card immediately re-renders in that partner's lane with a "Sent · pending" badge and a partner-color left rim so it visually reads as "handed off".
3. **Card stays on the creator's board forever.** After the partner accepts, the badge flips to "Accepted · at {Partner}". If the partner assigns a driver, the driver name appears on the same card. If the partner forwards to another partner C, a **second card** appears in C's lane on A's board (one card per hop). Cards for hops A doesn't own are read-only for A (no drag, no edit) but keep full chat + chain timeline + live status.
4. **Statement already carries chain trips** — we verify every hop is included and labeled with the executor company + driver, so the client-facing invoice from A always reflects the full A→B→C→driver chain.
5. **Outbound collapsed section is removed** — its purpose is now served by the always-visible partner lanes.

## Technical plan

### Data / server

- `listJobs` (coordinator): broaden filter to include jobs where `company_of(me)` is in `dispatch_chain_company_ids` OR equals `origin_company_id` (not only `company_id`/`executor_company_id`). Add derived fields per row:
  - `chain_role`: `"creator" | "executor" | "chain_viewer"`
  - `current_partner`: `{ id, name } | null` (the current `executor_company_id` if it's not me)
  - `hop_index`: which hop this card represents on my board
- New server fn `listPartnerLanes()` returning `[{ id, name, color_hint }]` from active `coordinator_connections` for the current company. Cached 60s.
- New server fn `getChainCardsForCreator(job_id)`: returns one row per hop where `from_company_id = me`, each mapped to a lane (target partner). Used to render one card per partner lane for the creator.
- Realtime: subscribe to `job_dispatch_hops` and `jobs` changes for any job in my chain, so cards update instantly across all hops without polling.

### Frontend (`coordinator.calendar.tsx`)

- Extend `DriverLanes` → `DispatchLanes` that renders **Driver lanes + Partner lanes** in the same horizontal scroll grid. Partner lanes use `useDroppable({ id: "partner:{companyId}" })`.
- `onDragEnd`: when `dropId` starts with `partner:`, open the existing `DispatchToPartnerDialog` prefilled with that partner and the job id — do not dispatch on drop.
- New card variant `PartnerHopCard` (reuses `TripCard` styling) with:
  - Left rim colored per partner (deterministic hash → HSL).
  - Status badge: `Sent · pending` / `Accepted` / `Rejected` (falls back off the lane on reject) / `In progress` / `Completed`.
  - Assigned driver name once the executor sets one (from live `jobs` row).
  - Buttons: **Open chat**, **Chain timeline**, **Details** (read-only for `chain_viewer` role).
- Chain expansion: for hop `A→B→C→driver`, the creator sees a card in B's lane AND a card in C's lane (one per hop), each showing its own hop status. Click either card → same `TripDetailsSheet` with `ChainTimeline` highlighted at that hop.
- Remove the collapsed `OutboundBoard` (superseded). Keep `InboundBoard` for partners receiving trips.

### Access + safety

- `TripDetailsSheet` and `TripChatDialog` already permit access for any company in the chain (`assertJobInCompany`). No policy changes needed; verify RLS on `jobs` still allows SELECT when `company_of(me) = ANY(dispatch_chain_company_ids)` (helper `job_in_my_chain` exists — add it to the jobs SELECT policy if not already used).
- Drop-to-partner is disabled if no active connection exists with that company (server-side `dispatch_job_forward` already enforces `not_a_partner`; UI just won't render a lane).

### Statements

- `buildStatement`: confirm rows are emitted per hop when the coordinator is `creator` (they should see A→B and B→C hops, executor names, drivers, and payment method), and only price when they're in the chain. Add a "Chain" column: `A → B → C → Driver Name`.

### Realtime + invalidations

- One `supabase.channel("chain-live")` subscribed to `jobs` and `job_dispatch_hops` filtered by `dispatch_chain_company_ids @> {me}`; invalidates `["jobs"]` and `["chain-cards", jobId]` on change.

## Out of scope

- Redesigning the driver lane card visuals.
- Changing how partners themselves see the trip (their existing Inbound + own lanes stay).
- Payment/pricing rules (already implemented last turn).

## Ask after build

Once live I'll ask whether partner lanes should be collapsible per-partner, and whether creator-side cards should show the partner's driver phone + live location by default or behind a click.
