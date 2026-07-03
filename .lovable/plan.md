
## Goal
Make the multi-coordinator chain bulletproof: both sides always see the trip, chains are strictly enforced, all chat threads are secure and simple, drivers must be registered to receive jobs, and the client sees the driver on an embedded live map (no Google Maps app hop).

---

## 1. Chain-aware trip visibility (both sides always see it)

**Server (`src/lib/coordinator.functions.ts`, `collab.functions.ts`)**
- `listJobsForCompany` (and the calendar query) now returns any job where the company is in `dispatch_chain_company_ids` — not just `company_id` / `executor_company_id`. Each row gets a computed `chain_role`: `origin | intermediate | executor`.
- After a dispatch is accepted, the trip STAYS on Coordinator A's board (previously it disappeared). It now shows on both A and B with a shared status badge (`Assigned to {B}`, `Accepted`, `In progress`, etc.), driven by the executor's live state.

**Calendar (`coordinator.calendar.tsx`, `TripCard.tsx`)**
- Origin/intermediate rows render read-only badge + "View chain" action (no drag, no direct status edit) — actions belong to the current executor.
- Executor row is fully interactive.
- Shared status badge color mirrors executor state so both sides see the same signal in real time (already wired via Supabase Realtime on `jobs` + `job_dispatch_hops`).

**Chain view / details**
- Clicking a trip anywhere in the chain opens `TripDetailsSheet` with the existing `ChainTimeline` prominently on top: origin → each hop → current executor → driver, with per-hop status, timestamps, and who did what. Everyone sees their own role highlighted.

---

## 2. Bulletproof dispatch rules

Enforced in `dispatch_job_forward` RPC (already SECURITY DEFINER) + a new precondition:

- Target company MUST be an `active` `coordinator_connections` partner of the current executor. Reject `not_a_partner` otherwise.
- Keep existing cycle detection and "only current executor can dispatch" checks.
- Driver assignment guard: `enforce_driver_assign_by_executor` already restricts driver changes to the current executor. Extend it so:
  - If the driver being assigned does NOT belong to the executor's company, mark the job `driver_external = true` and require the driver to have completed onboarding (see §4). No silent assignments to strangers.

---

## 3. Chats — secure, simple, no clutter

Extend `trip_messages` with a `thread` enum: `chain | coord_driver | coord_client | driver_client`.

Threads per trip:
- **Chain group** — all coordinators in `dispatch_chain_company_ids` + the current driver. Ops coordination.
- **Coordinator ↔ Driver (per hop)** — each coordinator has a private 1:1 thread with the assigned driver. RLS: `thread='coord_driver' AND (company_id = my_company OR i_am_the_driver)`.
- **Coordinator ↔ Client** — only the trip's ORIGIN coordinator can see/post. RLS scoped to `origin_company_id`.
- **Driver ↔ Client** — only current driver and client identity (via `client_link_identities`). No coordinator visibility.

UI: single `TripChatDialog` with tabs; only tabs the viewer is allowed in are shown. Blue-dot unread indicator per tab, already-existing pattern.

RLS updates in the migration:
- Rewrite `trip_messages` SELECT/INSERT policies to key off `thread` + role checks (`company_of(auth.uid()) = ANY(dispatch_chain_company_ids)`, `job.origin_company_id`, `job.driver_id`, magic-link identity for client/driver public routes).

---

## 4. Driver onboarding (mandatory when assigned outside their company)

- New table `driver_profiles` (or extend `drivers`): `full_name`, `phone`, `car_make_model`, `plate`, `seats_available`, `onboarded_at`.
- On first open of `/m.driver.$token`, if `onboarded_at IS NULL`, show a blocking `DriverOnboardingDialog` — cannot dismiss, cannot see trips until saved.
- Coordinators can only assign an external driver if that driver has `onboarded_at`. Otherwise the assign action shows "Waiting for driver to complete profile" and holds the trip in `pending_driver_onboarding`.
- Driver's own company keeps current behavior (no forced re-onboarding).

---

## 5. Statements always include the full chain

`buildStatement` (`coordinator.functions.ts`):
- Query jobs where viewer's company is in `dispatch_chain_company_ids`.
- New optional columns: `origin_company`, `chain (A → B → C)`, `executor_company`, `driver_company`, `viewer_role_in_chain`, plus existing pricing/payment/duration/distance.
- Filter row already covers company/driver/name/flight; add `chain_role` and `payment_method` filters (payment_method already added last turn).

---

## 6. In-app client live map (replace Google Maps hop)

Client trip route `/t/$token` (and `/m/client/$token`):
- Replace "Open in Google Maps" with an embedded `<ClientTripMap />` using the existing Google Maps JS loader (browser key already wired).
- Shows: driver live marker (from `driver_locations` realtime), pickup pin, dropoff pin, polyline route via Routes API through the gateway, live ETA text updated every 30s.
- Keep a small "Open externally" link as a fallback only.

Also audit other client-side actions on `/t/$token` and `/m/client/$token`: chat send, SOS, status refresh, refresh on background — confirm they all work (quick manual pass + fix anything broken).

---

## Technical section

**Migration**
- `ALTER TABLE public.trip_messages ADD COLUMN thread text NOT NULL DEFAULT 'chain' CHECK (thread IN ('chain','coord_driver','coord_client','driver_client'));`
- Rewrite `trip_messages` RLS policies per §3.
- `ALTER TABLE public.drivers ADD COLUMN onboarded_at timestamptz, ADD COLUMN car_make_model text, ADD COLUMN plate text, ADD COLUMN seats_available int;` (phone already exists).
- `ALTER TABLE public.jobs ADD COLUMN driver_external boolean NOT NULL DEFAULT false;`
- Update `dispatch_job_forward` to check `coordinator_connections` active partnership.
- Update `enforce_driver_assign_by_executor` to set `driver_external` and require onboarding.
- Do not add anon SELECT on `trip_messages`; use SECURITY DEFINER RPCs for magic-link posting/reading like today.

**Server functions**
- `listJobsForCompany`: broaden filter to `dispatch_chain_company_ids @> ARRAY[my_company]`, add `chain_role`.
- `postTripMessage(job_id, thread, body)` + `listTripMessages(job_id, thread)` with role checks.
- `saveDriverProfile(token, {full_name, phone, car, plate, seats})` via magic-link scoped RPC.
- `computeRouteForClient(job_id, token)` — server fn that calls Routes API via connector gateway using the client's magic-link token to authorize; returns polyline + duration.

**Frontend**
- `TripCard`: add `chain_role` styling — dashed border + "Watching" chip for non-executor rows.
- `TripDetailsSheet`: promote `ChainTimeline` to the top; add "Chats" tab with allowed threads only.
- `DriverOnboardingDialog` new component blocking `/m.driver.$token`.
- `ClientTripMap` new component on `/t/$token`.

**Out of scope this pass**
- Payment/pricing UI changes (last turn's work stays as-is).
- Any AI extraction changes.

