
# Coordinator Collaboration

Add a new "Collaborate" tab so a coordinator (A) can connect to another coordinator (B) either as a **Sync partner** (shared workspace with granular permissions A chooses) or as a **Provider** (A dispatches jobs to B; B runs them with B's drivers). Points are always paid by the sender (A).

## 1. Database (migrations)

New tables (all company-scoped, RLS, GRANTs):

- **coordinator_connections**
  - `owner_company_id` (A — inviter), `partner_company_id` (B — accepter)
  - `mode` enum: `sync` | `provider`
  - `status` enum: `pending` | `active` | `revoked` | `rejected`
  - `permissions` jsonb — set by A at invite time. Keys (booleans):
    `view_jobs`, `edit_jobs`, `create_jobs`, `view_drivers`, `assign_drivers`,
    `view_chat`, `post_chat`, `view_pax`, `edit_pax`. **Never** includes top-up/points.
  - `accepted_at`, `revoked_at`, timestamps
  - Unique `(least(owner,partner), greatest(owner,partner))` to prevent dupes

- **connection_invites**
  - `code` (short random, unique), `owner_company_id`, `mode`, `permissions` jsonb,
    `expires_at`, `used_at`, `used_by_company_id`
  - Used for the share-code handshake

- **jobs** additions (migration):
  - `origin_company_id` uuid — who created the job (A)
  - `executor_company_id` uuid — who runs it (B when dispatched; else same as origin)
  - `dispatch_status` enum nullable: `pending` | `accepted` | `rejected`
  - `dispatched_at`, `dispatch_decided_at`, `dispatch_note`
  - Existing `company_id` becomes the executor scope for driver/pax/chat RLS

- **driver_status_updates**: already exists; ensure Realtime publication added so A can subscribe to B's driver status for shared jobs.

RLS updates so a partner company can SELECT/UPDATE rows on the other's tables only when an **active connection** grants that specific permission (via a `has_connection_permission(auth_company, target_company, perm)` security-definer function). Provider mode grants B implicit access to the specific jobs A dispatched to B (and their pax/chat), never A's whole workspace.

## 2. Server functions (`src/lib/collab.functions.ts`)

- `createConnectionInvite({ mode, permissions, ttlDays })` → returns `code` + share URL
- `redeemConnectionInvite({ code })` → creates `coordinator_connections` row `active`
- `listConnections()` / `revokeConnection({ id })` / `updateConnectionPermissions({ id, permissions })` (owner only)
- `dispatchJobToPartner({ job_id, partner_company_id, note? })` → sets executor, `dispatch_status='pending'`, charges A via `charge_feature`
- `respondToDispatch({ job_id, decision, note? })` (B) → accept/reject; on accept, job appears on B's dispatch board
- `listIncomingDispatches()` (B) — pending queue
- Extend `listJobs` (A) to include partner-executed jobs with a read-only `partner_executor` flag and to surface `driver_name` + latest status from B's driver
- Realtime: subscribe A's board to `driver_status_updates` for jobs where `origin_company_id = A`

Points: `dispatchJobToPartner` deducts from A's balance using a new `feature_costs` entry `dispatch_partner`. B is never charged.

## 3. UI

New sidebar entry **Collaborate** in `coordinator.tsx` navigation.

- `src/routes/_authenticated/coordinator.collaborate.tsx`
  - Header actions: **New invite** (dialog: pick Sync/Provider, permission checkboxes for Sync, TTL) → copyable share code + link
  - **Redeem code** input to accept an invite
  - Table of active connections: partner name, mode, permissions summary, "Edit permissions", "Revoke"
  - Tabs: **My connections** / **Incoming invites**

- Dispatch board (`coordinator.calendar.tsx`)
  - New "Dispatch to partner" action on a trip card (visible when connections exist) → picks a partner, sends
  - Partner-executed trips render with a distinct badge and read-only status stream (driver name + status pulled from B)

- New page `coordinator.incoming.tsx` (B) — pending partner dispatches with Accept/Reject and optional note. Accepted jobs land on B's normal dispatch board where B splits pax to B's drivers as today.

- Trip chat (`TripChatDialog`) — if connection permission `view_chat`/`post_chat` allows, A can read/post on partner-executed jobs.

## 4. Realtime & visibility

- Enable Realtime on `jobs`, `driver_status_updates`, `pax` for cross-company subscribers.
- A's calendar subscribes to updates for jobs where `origin_company_id = A.company_id` and renders driver name + status just like an internal driver (read-only). A cannot reassign B's drivers.

## 5. Out of scope (for this iteration)

- Bi-directional Sync of top-ups, billing, or points balance (explicitly excluded per your rule)
- Multi-hop dispatch (B forwarding to C)
- Partner analytics dashboard
- Per-driver ratings across companies

## Technical notes

- All new tables get `GRANT SELECT, INSERT, UPDATE, DELETE ... TO authenticated; GRANT ALL ... TO service_role;` in the same migration.
- Cross-company visibility is enforced via a SECURITY DEFINER helper `has_connection_permission(_viewer_company, _target_company, _perm text)` to avoid RLS recursion.
- Points deduction reuses existing `charge_feature` RPC.
- Add a Realtime subscription hook `useJobRealtime(companyId)` in `src/hooks/`, mounted from the calendar and cleaned up on unmount.
