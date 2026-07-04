
# Driver & partner price proposals (private, per-hop)

Add an optional "propose a price" step before a driver (or a receiving coordinator in a dispatch chain) accepts a job. The sender sees a flashing notification and can **Accept**, **Counter**, or **Recall**. Prices are private to the two adjacent parties on that hop — upstream coordinators never see downstream numbers.

Currency: **EUR (€)** everywhere. If no price is proposed, existing accept flow is unchanged.

## Data model

New table `public.job_price_proposals`:

- `job_id` (fk `jobs.id`)
- `hop_id` (fk `job_dispatch_hops.id`, nullable — null when it's the driver↔executor hop)
- `from_party_kind` `'driver' | 'company'`
- `from_company_id`, `from_driver_id` (nullable, one set based on kind)
- `to_company_id` (the receiver — always a company; the sender of the trip on that hop)
- `amount_eur` numeric(10,2)
- `status` `'proposed' | 'accepted' | 'countered' | 'recalled' | 'superseded'`
- `parent_id` (fk self, for counter-offer chains)
- `note` text nullable (short optional message)
- `created_at`, `responded_at`, `responded_by_user_id`

Indexes: `(job_id, status)`, `(to_company_id, status)`, `(from_driver_id, status)`.

RLS: SELECT/INSERT allowed only when `auth.uid()` belongs to `from_company_id`, `to_company_id`, or is the linked user of `from_driver_id`. Admin bypass via `has_role`. Driver writes go through a token-gated server fn (no auth uid), so include a service-role path for the driver endpoint.

## Server functions

`src/lib/coordinator-public.functions.ts` (driver token):
- `proposeDriverPrice({ token, job_id, amount_eur, note? })` — inserts a `proposed` row with `from_party_kind='driver'`, `from_driver_id=<token driver>`, `to_company_id = executor_company_id ?? company_id`. Supersedes any prior open proposal from that driver on the same job. Job status stays `assigned` (not accepted).
- `respondToDriverCounter({ token, proposal_id, action: 'accept' | 'recall_price' })` — driver-side response to a coordinator counter-offer.
- `listMyDriverPriceThread({ token, job_id })` — returns the proposal chain visible to the driver.

`src/lib/collab.functions.ts` (partner/coordinator, `requireSupabaseAuth`):
- `proposePartnerPrice({ job_id, hop_id, amount_eur, note? })` — a receiving coordinator (downstream of another coordinator) proposes a price back up the chain. Sets `from_company_id = my company`, `to_company_id = previous hop's company`.
- `respondToPriceProposal({ proposal_id, action: 'accept' | 'counter' | 'recall_assignment' | 'reject_price', counter_amount_eur? })`:
  - `accept` → mark `accepted`, no side effect on job status.
  - `counter` → insert new `proposed` row with sides swapped and `parent_id` set; original marked `countered`.
  - `reject_price` → mark `recalled`; job stays assigned to the same party (see recall dialog below).
  - `recall_assignment` → mark `recalled`; also unassign: if driver hop, clear `jobs.driver_id`; if partner hop, revert `executor_company_id` to the previous hop's company and mark that `job_dispatch_hops` row `revoked`.
- `listPriceProposals({ job_id })` — returns only rows where my company is `from_company_id` or `to_company_id`.

All fns validate `amount_eur > 0` and `< 100000`.

## Driver app (`src/routes/m.driver.$token.tsx`)

Inside each `JobCard`, when `status === 'assigned'` and no `accepted` proposal from this driver exists:

- New button row above **Accept**: `€ Propose price` (opens a small dialog with a numeric input + optional note). While a proposal is `proposed` or `countered` from the coordinator, show a compact strip:
  - "You proposed €45.00 — waiting for reply" (with **Withdraw** → sets `recalled`)
  - Or "Coordinator counter-offer: €38.00" with **Accept** / **Withdraw** buttons.
- **Accept** button stays as-is; if the driver clicks Accept while a proposal is open, treat it as implicit price withdrawal + accept.

## Coordinator app

`src/routes/_authenticated/coordinator.calendar.tsx` (job list):
- Jobs with an open incoming proposal get a pulsing `€` badge (Tailwind `animate-pulse` on a small chip showing the amount).
- New sidebar/nav item is **not** added — reuse the existing header bell area: a small popover "Price proposals (N)" surfacing all open proposals across jobs, click to open the trip.

`src/components/coordinator/TripDetailsSheet.tsx`:
- New section "Price proposals" (only rendered when `listPriceProposals` returns rows involving my company). Shows the chain most-recent-first. For an open proposal `to_company = me`:
  - Buttons: **Accept**, **Counter €** (opens amount input), **Recall** (opens dialog: *Reject price only* vs *Recall assignment*).
  - For driver-hop rows the "Recall assignment" button unassigns the driver; for partner-hop rows it reverts executor to previous company.
- For rows where `from_company = me` and status is `proposed`, show "Waiting for {receiver name}" + **Withdraw**.

`src/components/coordinator/DriverLiveMap.tsx` / dispatch UI: when forwarding a job to another partner, a downstream partner sees the same "Propose price" button in `TripDetailsSheet` targeting the upstream coordinator.

## Privacy enforcement

- RLS restricts row visibility to the two parties on that proposal only.
- `listPriceProposals` additionally filters by my company for defense-in-depth.
- Driver token fns only return rows where `from_driver_id` matches the token's driver.
- No proposal data is included in the existing `getJob` / dispatch payloads.

## Notifications

- Coordinator: reuse the existing unread-badge polling in `use-coordinator.ts` — extend `getDashboardSummary` to also return `open_price_proposals` count for my company as `to_company_id`. The dashboard "Pending approvals" card gets a sibling **Price proposals** card with `animate-pulse` when count > 0.
- Driver: the JobCard renders the pulsing strip inline (no push notification in this change).

## Technical notes

- Migration: create table + GRANTs (`GRANT SELECT, INSERT, UPDATE ON public.job_price_proposals TO authenticated; GRANT ALL ... TO service_role;`) + RLS policies + updated_at trigger.
- Amount stored as `numeric`, displayed with `new Intl.NumberFormat('en-IE', { style:'currency', currency:'EUR' })`.
- "Recall assignment" for a partner hop uses existing hop-revocation logic in `collab.functions.ts` (reuse the same helper if present, otherwise add one that only the current executor can call).
- No changes to existing accept flow when no proposal exists — backwards compatible.

## Out of scope

- Multi-currency, invoicing, payout tracking, price history analytics.
- Auto-accept thresholds or price suggestions.
- Push notifications.
