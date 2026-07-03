## Goals

Preserve the trip's link to its creator across the full dispatch chain, so:
1. A dispatched trip stays in the partner's lane on the creator's board — even after the partner accepts.
2. If the partner splits the trip (pax split into a new trip), the creator sees one card per resulting sub‑trip in the same partner lane.
3. The creator keeps full ownership: continues to communicate with the client and drivers, and statements always show the A → B → C chain with the driver.

## What's broken today

- `respondToDispatch` (accept branch) rewrites `jobs.company_id` to the partner. That transfer:
  - Removes the trip from the creator's `mineQ` in `listJobs`, so it disappears from the creator's board once accepted.
  - Breaks "creator owns the client/driver record" — chat, statements, portal all key off `company_id`.
- `splitPaxToNewJob` inserts a brand‑new job with only `company_id = partner`, no `origin_company_id`, no `dispatch_chain_company_ids`, no `parent_job_id`. The creator has no way to know a split happened.
- Calendar `PartnerLane` filter already includes `executor_company_id === partner`, so lane visibility is fine once ownership is preserved.

## Changes

### 1. Keep creator as owner on accept
File: `src/lib/collab.functions.ts` — `respondToDispatch`, accept branch.

- Do NOT set `company_id: c.id`. Keep `company_id` = creator's id.
- Only update: `dispatch_status = 'accepted'`, `dispatch_decided_at`, `dispatch_note`. `executor_company_id` already points at the partner from the dispatch call.
- Reject branch stays as-is (it just walks `executor_company_id` back).

Effect: creator's `mineQ` in `listJobs` still returns the trip; it renders in the partner lane via the existing `executor_company_id` filter and the `creator_watching` chain role.

### 2. Split by partner must fan out to the creator
File: `src/lib/coordinator.functions.ts` — `splitPaxToNewJob`.

- Allow the current executor (not just `company_id`) to split: fetch by id, verify `company_id === c.id || executor_company_id === c.id`.
- When the caller is the executor-partner of a dispatched trip (source `company_id !== c.id`), the new job must inherit the chain so the creator sees it:
  - `company_id = src.company_id` (creator)
  - `origin_company_id = src.origin_company_id ?? src.company_id`
  - `executor_company_id = c.id` (partner keeps executing the split)
  - `dispatch_chain_company_ids = src.dispatch_chain_company_ids`
  - `dispatch_status = 'accepted'`, `dispatched_at = src.dispatched_at`
  - `parent_job_id = src.id`
  - `driver_id`/`vehicle` = partner's chosen values
- When the caller is the plain owner (no dispatch), keep today's behavior (`company_id = c.id`, no chain fields).
- Also insert a `job_dispatch_hops` row mirroring the source's latest accepted hop so the split shows up in chain timelines and statements.

Effect: on the creator's board, `listJobs`'s `mineQ` returns the source AND the split as separate rows; both appear in the partner's lane. On the partner's board, `outQ` returns both via `dispatch_chain_company_ids`.

### 3. Creator keeps client/driver comms + statement chain
- With (1) in place, `company_id` remains the creator, so the existing coordinator chat, client portal, driver assignment, and `buildStatement` already resolve to the creator and render the chain (`chain: A → B → C`, `driver_name`, `executor_company`). No further changes required beyond ensuring the split hops row is written so `chain_hops` reflects reality on split children.
- Add a small guard in `listJobs` so a dispatched trip whose `executor_company_id !== c.id` still surfaces the partner's `drivers(name)` under `external_driver_name` (already done) — verify split children behave the same.

### 4. Migration
No schema change required. All fields used (`origin_company_id`, `executor_company_id`, `dispatch_chain_company_ids`, `parent_job_id`, `job_dispatch_hops`) already exist.

### 5. Backfill (one-time)
For jobs where `dispatch_status = 'accepted'` and `origin_company_id IS NOT NULL` and `company_id = executor_company_id` (i.e. previously transferred), reset `company_id = origin_company_id` so historical trips reappear on the original creator's board and statements. Ship as a data migration via the insert tool.

## Files to touch

- `src/lib/collab.functions.ts` — `respondToDispatch` (accept branch only).
- `src/lib/coordinator.functions.ts` — `splitPaxToNewJob` (executor path + chain inheritance + hop insert).
- One data migration to backfill transferred `company_id` values.

## Verification

- Dispatch trip A→B, accept as B: card remains in creator A's partner-B lane; chat + client portal still owned by A; statement row shows `A → B`, driver from B.
- On B, split 2 pax: A now sees 2 cards in the partner-B lane; B sees 2 cards in its board. Statement (A, chain scope) shows both rows with chain `A → B`.
- Multi-hop A→B→C: same behavior; both source and split children stay owned by A; statement shows `A → B → C`.
