# Driver-Consent Flow — Round 2

Building on the enforcement work already shipped (assignments always require a fresh `driver_accepted_at`, pending banner + amber card border, required decline reason, chime/vibration on reassignment).

## 1. Coordinator visibility

**Data source**: `driver_id IS NOT NULL AND driver_accepted_at IS NULL` = pending. Already selected in `listJobs` / calendar / board queries — no schema work needed.

- **Card badge**: amber "Awaiting driver" pill on every trip card in the board, calendar, incoming, and TripDetailsSheet. Sits next to the existing status badge; colored to match the driver-side amber.
- **Board filter chip**: add "Awaiting acceptance (N)" quick-filter to the coordinator board toolbar so a coordinator can see at a glance what's stuck.
- **Auto system message in trip chat**: when `assignDriver` sets a new driver, insert a `trip_messages` row (`sender_kind='system'`, `thread_kind='driver_coord'`) — "🕓 Waiting on {driver name} to accept this trip." When the driver accepts, insert "✅ {driver} accepted." When they decline, the existing decline message already posts.
- **Time-based escalation**: derived client-side from `pickup_at - now()`. Rules:
  - Pending + pickup > 2h away → amber pill.
  - Pending + pickup ≤ 2h away → red pulsing pill + card ring; coordinator dashboard shows a top toast "1 trip near pickup still not accepted."
  - Pending + pickup passed → red "Overdue acceptance" pill.

No new tables — the color/text is a pure function of the two fields.

## 2. Driver web-push (VAPID)

**New table `driver_push_subs`** (mirrors `client_push_subs`):
```
id, driver_id, endpoint (unique), p256dh, auth, user_agent,
created_at, last_used_at
```
RLS: no client access (writes happen through token-scoped server fns, reads only from the admin client). Standard GRANTs.

**New secret**: `VAPID_PRIVATE_KEY` (generated). `VAPID_PUBLIC_KEY` already implied by the existing `getPushVapidPublicKey` fn — will reuse.

**Server fns (token-scoped, same pattern as client push)** in `coordinator-public.functions.ts`:
- `driverSubscribePush({ token, endpoint, p256dh, auth, user_agent })` — upserts by endpoint under the driver's token.
- `driverUnsubscribePush({ token, endpoint })`.
- `sendDriverPushForJob(job_id, kind)` — server-only helper (not exposed). Uses `web-push` npm package on the Worker.

**Wiring**:
- In `assignDriver` (and any code path that sets `driver_id`), fire-and-forget `sendDriverPushForJob(job_id, "assigned")` after the update succeeds.
- Payload: `{ title: "New trip — tap to accept", body: "{from} → {to} at {time}", url: "/m/driver/{token}#job-{id}" }`. Token resolved from `driver.linked_user_id` via the driver's active magic link (falls back to skipping push if no live token, so nothing crashes).
- On click, service worker (`public/sw.js`) opens the URL, focusing an existing tab if the token matches.

**Driver dashboard**:
- Small "Enable trip alerts" banner near the pending banner when `Notification.permission === 'default'` and push is supported. One tap requests permission + subscribes.
- Menu item "Push notifications: on / off" to unsubscribe.

**Fallback**: everything else (chime, vibration, in-app banner) still works when push is denied or unsupported (iOS < 16.4 in non-PWA context).

## 3. Cross-company: partner coordinator accepts first

**New job column** `partner_accepted_at TIMESTAMPTZ` — nullable, defaults null.

**Trigger `enforce_partner_accept_before_driver_assign`** on `jobs`: if a coordinator from company X sets `driver_id` to a driver whose `company_id != company_of(actor)` OR the job's `executor_company_id` was just set to a partner company, and `partner_accepted_at IS NULL`, raise `partner_must_accept_first`. Server fns catch this and return a clean error.

**Provider-dispatch server fns** (in `collab.functions.ts` / new `dispatch.functions.ts`):
- `dispatchToPartner({ job_id, partner_company_id })` — the sending coordinator picks a connected provider company; sets `executor_company_id = partner_company_id`, appends to `dispatch_chain_company_ids`, leaves `partner_accepted_at = null` and `driver_id = null`. Auto-posts trip-chat system message "📩 Dispatched to {partner name} — awaiting their acceptance."
- `partnerAcceptDispatch({ job_id })` — middleware `requireSupabaseAuth`; verifies actor's company = current `executor_company_id`; sets `partner_accepted_at = now()`; posts "✅ {partner} accepted — now assigning driver."
- `partnerRejectDispatch({ job_id, reason })` — required reason from same short list; reverts `executor_company_id` to the previous hop (or origin), pops the chain, posts a system message with the reason.

**Coordinator UI** — new page `/coordinator/incoming` already exists; extend it:
- Two tabs: "Pending dispatches" (jobs where I am current executor and `partner_accepted_at IS NULL`) and "My open trips."
- Each pending row: Accept / Decline (reason picker), just like the driver flow.
- Trip cards in the sending coordinator's board show a purple "With {partner} — awaiting acceptance" badge.

**Driver visibility on a partner-dispatched trip**: driver only sees it in their manifest once `partner_accepted_at IS NOT NULL` AND `driver_id = them`. The `getDriverManifest` query already filters by `driver_id`, so this is automatic — driver never sees a job until their coordinator has said yes.

## 4. Escalation & fallback details

- If a partner coordinator sits on a pending dispatch for > 30 min, the sending coordinator's card flips to red with a "Nudge" button that posts a chat prod and re-sends the push (planned for a follow-up if time allows).
- All new server fns validate input with Zod and use `requireSupabaseAuth` where a session is needed.
- Auto-approve chain: an in-house driver assignment (same company) still auto-nulls `driver_accepted_at` — no coord-level accept required, only the driver's. That matches option 1 from the user's earlier answer ("all new assignments" get driver accept, but cross-company also adds a coordinator-accept layer).

## Technical notes

- No changes to auto-generated files (`types.ts`, `client.ts`, `routeTree.gen.ts` regenerates itself).
- `web-push` package: verify Cloudflare Workers compatibility before install; fall back to raw Web Crypto VAPID + fetch if not compatible (same approach used by existing client push if present).
- All new tables get GRANT + RLS + service_role in one migration; policies deny anon writes.
- Trigger and column changes ship in a single migration alongside a backfill: `UPDATE jobs SET partner_accepted_at = now() WHERE executor_company_id IS NULL OR executor_company_id = company_id` so existing in-house jobs aren't blocked.
- I'll wire the push send inline in `assignDriver` behind a try/catch so a push failure never blocks the assignment itself.

## What ships in this pass

1. Migration: `partner_accepted_at` column + trigger + backfill; `driver_push_subs` table.
2. Coordinator badges + escalation colors + auto system messages (no new tables).
3. Push subscribe/unsubscribe fns + service worker handler + `sendDriverPushForJob` helper + wiring in `assignDriver`.
4. Partner accept/decline fns + `/coordinator/incoming` extension.
5. Secret: generate `VAPID_PRIVATE_KEY`.

Confirm and I'll execute.
