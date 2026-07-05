# Full App Map — Product Deep-Dive + Technical Blueprint

I'll produce **two Markdown files** in `/mnt/documents/` you can paste into any AI, and preview both inline. Real DB snapshots (already fetched) are embedded so the AI reasons on truth, not assumptions.

---

## Deliverable 1 — `crew-change-product-map.md` (~20 pages)

Written for a **product analyst AI**. No code — pure product model.

**Sections**
1. **What the app is** — one-paragraph description, target user (dispatch coordinators for transport companies in Malta), value proposition, primary jobs-to-be-done.
2. **User roles & personas** — Platform Admin · Company Owner/Coordinator · Sub-Coordinator · Driver (via magic link, no account) · Client (via magic link or public booking form). What each can/can't do.
3. **Feature catalog (all 22 features)** — for each: name, what it does, who touches it, screen it lives on, points cost, plan availability. Marked "AI feature" where relevant.
4. **Complete user journeys** (step-by-step):
   - Company signup → admin approval → first login → change password → add drivers → create first trip
   - Coordinator creates trip via 5 paths: manual form, bulk paste, XLSX import, AI extraction (text/file/URL), voice note
   - Driver receives job → accepts/rejects → status transitions → pax boarding → completion → statement
   - Client books via public link → coordinator approves → trip runs → client tracks live → SOS
   - Multi-hop B2B dispatch (Company A → B → C) with price negotiation
   - Monthly billing cycle: plan → included points → top-up → rollover
5. **Business rules & constraints** — 2-hour rule (late edits become modifications), hop immutability, driver self-update rules, single-admin enforcement, Malta timezone.
6. **Pricing model — LIVE VALUES**:
   - **Plans**: Starter €0/mo (50 pts, 5 features) · Pro €49/mo (500 pts, 13 features) · Business €149/mo (2 000 pts, 22 features)
   - **Point packs**: Small 100pts/€9 · Medium 500/€39 · Large 2 000/€129 · Mega 10 000/€499
   - **AI costs** (per action, points): auto-assign 2 · auto-coordinate 2 · command read 2 / execute 3 · daily plan 5 · extraction text 2 / media 3 · reply drafter 1 · voice-to-trip 2
   - **Core costs**: trip_created 1 · trip_dispatched 1.5 · client_link_sent 0.25 · flight_status 0.1 · route_traffic 0.1
7. **Current state snapshot** (real numbers): 3 companies · 1 admin · 4 drivers · 14 jobs · 26 ledger entries · 6 AI commands · 3 magic links · 2 pending access requests · 0 client bookings · 0 partner connections · 0 dispatch hops · 1 top-up request.
8. **Feature entitlement mechanics** — how admin toggles work, opt-out default, realtime hide within ~seconds, deep-link redirect + inline banner (recently added).
9. **Product analysis hooks** — a checklist of open questions the AI should probe: activation funnel, feature discoverability, points anxiety, dispatch chain UX, mobile parity, empty-state coverage, upgrade prompts, retention loops.
10. **Known gaps & inconsistencies** (I found while mapping):
    - Two overlapping cost tables: `ai_feature_costs.feature_key` (text, 15 rows) vs `feature_costs.feature_name` (enum, 10 rows). Server code reads `ai_feature_costs` — `feature_costs` looks orphaned/legacy.
    - `plans.feature_keys` array duplicates entitlement info held in `company_feature_entitlements`. Which wins on conflict is not obvious.
    - `LOVABLE_API_KEY` + `ai-gateway.server.ts` present but unused — all AI still goes through raw Gemini REST.
    - No unit or e2e tests exist.
    - `client_bookings=0` and `coordinator_connections=0` in production — flagship features have never been used in the real DB.

---

## Deliverable 2 — `crew-change-technical-blueprint.md` (~50 pages)

Written for a **code-analyst AI**. Extends the earlier blueprint with exhaustive detail.

**Sections**
1. **Tech stack** (full `package.json` breakdown with versions)
2. **Routes** — every URL + file + purpose (already have this)
3. **Components** — every file, grouped by folder
4. **Server functions catalog** — every export from `admin.functions.ts`, `coordinator.functions.ts`, `coordinator-public.functions.ts`, `billing.functions.ts`, `booking.functions.ts`, `collab.functions.ts` with signature, auth requirement, points spend, and description
5. **Database — full schema dump**: every column, type, nullability, default; every RLS policy verbatim; every trigger; every RPC. (I already pulled the raw data — 46 tables, 83 policies, 20 DB functions.)
6. **Auth & security model** — Supabase session flow, `attachSupabaseAuth` middleware, `requireSupabaseAuth`, `is_admin` / `is_company_owner` / `company_of` helpers in `private` schema, magic-link validation, public-endpoint rules.
7. **Realtime channels** — every `supabase.channel(...)` call in the codebase, table filter, and consumer.
8. **AI pipeline** — `callGemini` helper, model routing (`gemini-2.5-flash` vs `flash-lite`), `buildSystemPrompt` composition, `company_ai_rules` injection, per-feature spend contract.
9. **Points & billing engine** — `spend_points` RPC walkthrough, `company_subscriptions` vs `companies.points_balance` fallback, block-on-empty semantics, monthly cap, rollover.
10. **Email queue** — pgmq structure, `email_queue_wake` advisory-lock arm/disarm dance, TTL and retry semantics, DLQ.
11. **Multi-hop dispatch state machine** — jobs/hops table invariants, `enforce_hop_immutable_fields`, `enforce_jobs_partner_update`, `enforce_driver_assign_by_executor` triggers.
12. **Environment variables** — full matrix (browser vs server, required vs optional, purpose).
13. **Build & deploy** — TanStack Start on Cloudflare Workers via `@lovable.dev/vite-tanstack-config`; SSR vs `_authenticated` (ssr:false) split; Capacitor build path.
14. **Extension points & refactor candidates** — the code smells the AI should investigate first.

---

## Sample excerpt (so you see the shape)

> **Feature: AI voice-to-trip**
> **File:** `src/components/coordinator/VoiceToTripButton.tsx` → server fn `aiVoiceNoteToTrip` in `src/lib/coordinator.functions.ts:3282`
> **Model:** `gemini-2.5-flash` (multimodal, base64 audio inline)
> **Auth:** `requireSupabaseAuth`
> **Gate:** `assertFeatureEnabled(companyId, "ai_voice_to_trip")` → default enabled on Business plan
> **Cost:** 2 points via `spendOrThrow` → `spend_points` RPC → `points_ledger`
> **Flow:** Browser `MediaRecorder` → base64 → server fn → Gemini → JSON trips → coordinator confirms → `createJobsBulk`
> **Known issue:** No UI cap on recording length; a 60-second recording is still 1 spend.

---

## Delivery

On approval I will:
1. Write `/mnt/documents/crew-change-product-map.md`
2. Write `/mnt/documents/crew-change-technical-blueprint.md`
3. Embed both real-value snapshots (plans, packs, AI costs, current-state counts).
4. Preview both files inline in the chat with `<presentation-artifact>` download tags.

Approve to generate.
