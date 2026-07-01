
# Multi-hop dispatch visibility

Today a job dispatched from A → B is visible to A because we set `origin_company_id = A` and `executor_company_id = B`. When B accepts, we overwrite `company_id = B` so it lands on B's board. If B then dispatches to C (or C to D), A loses sight of the trip — `origin_company_id` still says A, but `dispatched_at`, `dispatch_status`, `dispatch_note`, and any driver/status updates only reflect the last hop. This plan makes the full chain observable to every upstream coordinator, in real time, without letting anyone reassign someone else's drivers.

## 1. Data model — track the chain, not just the last hop

New table `job_dispatch_hops` (append-only history of every handoff for a job):

- `job_id` (fk jobs)
- `hop_index` int (0 = original creator, 1 = first partner, …)
- `from_company_id`, `to_company_id`
- `status` enum: `pending` | `accepted` | `rejected` | `cancelled`
- `note`, `dispatched_at`, `decided_at`
- unique `(job_id, hop_index)`

Keep the existing columns on `jobs` (`origin_company_id`, `executor_company_id`, `dispatch_status`, `dispatched_at`, `dispatch_decided_at`, `dispatch_note`) as the "current hop" convenience view — every insert into `job_dispatch_hops` also updates those fields on the job. A single source of truth (`hops`) plus a denormalised head (`jobs.*`) keeps existing UI working.

Add `jobs.dispatch_chain_company_ids uuid[]` — ordered list of every company that has ever touched the trip (creator + each accepter). Maintained by the same helpers that write hops. This one column powers cross-company RLS reads without recursive joins.

Enable Realtime on `job_dispatch_hops` (`jobs`, `driver_status_updates`, `pax` are already published).

## 2. RLS — upstream companies can always read, never write drivers

Replace the current cross-company read policy on `jobs`, `pax`, `driver_status_updates`, `trip_messages`, `job_dispatch_hops`:

- SELECT allowed if `auth`'s company is `= ANY(jobs.dispatch_chain_company_ids)` OR it is the current `executor_company_id`.
- UPDATE on `jobs` restricted to the current `executor_company_id` (owner of the current hop). Upstream reads only.
- Driver assignment (`jobs.driver_id`) writable only by the current executor — enforced by the existing policies plus a trigger that rejects driver_id changes from anyone other than `executor_company_id`.
- `driver_status_updates` insert stays restricted to the driver/executor; SELECT opens up to the whole chain.
- Chat: `trip_messages` SELECT opens to the chain; POST stays per-hop permission (`view_chat` / `post_chat` in sync mode, or executor + origin in provider mode).

`has_connection_permission` stays for sync-mode granular perms; chain visibility is orthogonal (any past participant reads).

## 3. Server functions

Extend `src/lib/collab.functions.ts`:

- `dispatchJobToPartner` — now the same fn works for any hop:
  - verify caller's company `= jobs.executor_company_id` (only the current owner can forward)
  - reject if `partner_company_id` already appears in `dispatch_chain_company_ids` (no cycles)
  - append a `job_dispatch_hops` row, update jobs head, push partner into `dispatch_chain_company_ids`, charge caller 1 point via `charge_feature('dispatch_partner')`
- `respondToDispatch` — on accept, set `company_id = caller`, mark hop `accepted`, keep origin intact
- New `listJobChain({ job_id })` — returns ordered hops + participating company names + current driver name/status; used by a "Chain" tab on the trip card and by the outbound dashboard
- Extend `listOutboundDispatches` (A's view): return every job where A appears in the chain but is not the current executor, with fields `current_executor`, `current_hop_status`, `driver_name`, latest `driver_status_updates.status` and `updated_at`, and the full hop list
- Extend `listJobs` to include chain-visible jobs in a read-only tint when A is upstream but not the current owner (opt-in flag `include_chain: true`, off by default so the calendar isn't cluttered — surfaced instead through the Outbound board)

## 4. Realtime hook

New `src/hooks/useChainJobRealtime.ts`:

- Subscribe to `jobs`, `job_dispatch_hops`, `driver_status_updates`, `pax` filtered by the set of job ids the current company has chain visibility on.
- Mount from `coordinator.incoming.tsx` (outbound tab) and the trip detail dialog.
- Invalidate the relevant React Query keys on every event.

## 5. UI

- `coordinator.incoming.tsx` — Outbound section becomes a full "Trips I sent" board:
  - columns: pickup, route, current executor, current hop status, driver, live status, chain depth
  - expandable row: hop timeline (A → B → C → …), with badges per hop (`pending` / `accepted` / `rejected`), note, timestamp, and the currently assigned driver at each accepted hop
  - live updates via the new realtime hook
- Trip card on dispatch board — new small "chain" chip when `hop_count > 1`; click opens the same hop timeline dialog.
- Chat (`TripChatDialog`) — participant list shows every company in the chain (read for all upstream; posting still gated by connection perms of the current hop).
- Driver portal is unchanged: the driver only sees the current executor's manifest.

## 6. Points & safeguards

- Points are charged only to the company doing the forward (existing behaviour). Origin never pays for downstream hops.
- Cycle guard rejects forwarding back to any earlier company in the chain.
- Rejection sends the trip back to the previous hop (not the origin) — chain shrinks by one, `dispatch_chain_company_ids` trimmed accordingly. Origin sees the reject event in the timeline.

## 7. Out of scope

- Per-hop payment splits or settlement between companies
- Driver ratings across the chain
- Allowing origin to override a downstream driver assignment

## Technical notes

- Migration writes `job_dispatch_hops` (+ GRANTs + RLS), adds `dispatch_chain_company_ids uuid[]` to `jobs`, backfills existing dispatched rows so the two current participants appear in the chain array, adds triggers/policies described above, and adds `job_dispatch_hops` to `supabase_realtime` publication.
- All chain reads use `dispatch_chain_company_ids && ARRAY[auth_company]` in policies (indexable via GIN) — no recursion, no security definer needed beyond what already exists.
- `charge_feature('dispatch_partner')` is reused; no new feature cost row required.
