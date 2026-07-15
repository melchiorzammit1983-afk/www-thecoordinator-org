# Coordinator Copilot — Roadmap

**Status:** Design only. No code changes.
**Owner:** Coordinator platform
**Related:** `src/lib/coordinator.functions.ts` (AI Command Bar), `src/routes/_authenticated/coordinator.ai-center.tsx`, `ai_command_log`, `trip_audit_log`, `company_ai_rules`, `ai_configuration`.

The Copilot builds on the existing AI Command Bar (read/agent modes with human approval) and evolves it into a supervised autonomous dispatcher over four phases. Each phase is independently shippable and gated behind `company_feature_entitlements` + per-user opt-in.

---

## Guiding principles (all phases)

- **Deterministic before generative.** Structured tools (SQL views, RPCs) beat free-form prompts. The LLM decides *which* tool to call, not the data.
- **Every write goes through existing server functions** — never let the LLM touch Supabase directly. Reuses RLS, audit triggers, points ledger, and hash-chained `trip_audit_log`.
- **Human-in-the-loop by default.** Autonomy is opt-in per action class, per company, and revocable in one click.
- **Full traceability.** Every prompt, tool call, tool result, and downstream side effect writes to `ai_command_log` and (when applicable) `trip_audit_log` under `actor_type='ai'`.
- **Points-aware.** Every LLM call and every tool call spends from the company points ledger via `spend_points` so operators see cost per Copilot session.

---

## Phase 1 — Read-only Copilot ("Ask")

The Copilot answers natural-language questions about live operational state. No writes. Ship first.

### Scope

Answerable domains:
- Trips (status, ETAs, driver, pax, chain position, labels, price proposals)
- Drivers (online/offline, current job, last GPS, utilization today)
- Passengers (bookings, portal activity, boarding approvals)
- Waiting sessions (open, elapsed, free window remaining, proposed charges)
- Boarding approvals (pending pax approvals per trip)
- Emergency overrides (recent forced status changes with reason/photo)
- Safety events (safety mode triggers, safety_concern / breakdown flags)
- Grouped trips (stops, reorder requests, optimization status)
- Route optimization (pending suggestions, savings, approval state)
- Audit logs (last N events for a trip, hash-chain integrity check)

### Architecture

```
Coordinator UI (AI Center chat)
  → runCopilotQuery serverFn (mode='ask')
     → build tool catalog (read-only)
     → LLM (google/gemini-3.5-flash) with tool calling
        ↺ tool: query_trips / query_drivers / query_waiting / ...
     → format markdown answer + citations (job_id, driver_id)
  → persist to ai_command_log (mode='ask', actions=[])
```

- Reuse the existing gateway wrapper (`src/lib/ai-gateway.server.ts`).
- Tools are thin wrappers over existing server functions and new read-only views — never raw SQL.
- Answers cite entities as clickable chips (`#a1b2` → open TripDetailsSheet).

### Database requirements

Additive only:
- `copilot_sessions` — session id, coordinator user_id, company_id, started_at, ended_at, points_spent, model.
- `copilot_messages` — session_id, role (`user|assistant|tool`), content, tool_name, tool_input, tool_output, tokens_in, tokens_out, created_at.
- Views (materialized where hot):
  - `v_copilot_trip_snapshot` — one row per active trip with denormalized driver, pax, group, waiting, ETA fields (avoids `SELECT *` on `jobs`).
  - `v_copilot_driver_snapshot` — online drivers with last location, current job, today's counts.
  - `v_copilot_waiting_open` — open `job_wait_sessions` joined with elapsed + free window.
- No changes to existing tables. All views enforce `company_id = current_company_id()`.

### APIs required

New server functions in `src/lib/copilot.functions.ts` (all `requireSupabaseAuth`, `has_role('coordinator')`):
- `startCopilotSession()` → session_id
- `askCopilot({ session_id, prompt })` → streamed markdown + tool trace
- `listCopilotSessions()` / `getCopilotSession(id)`

Read tools exposed to the LLM (each a Zod-validated serverFn):
- `search_trips({ date?, status?, driver_id?, pax_query?, label?, group_id?, limit })`
- `get_trip({ job_id })`
- `list_drivers({ online_only?, available_only? })`
- `list_open_waiting_sessions()`
- `list_pending_boarding_approvals()`
- `list_recent_emergency_overrides({ hours })`
- `list_safety_events({ hours })`
- `list_groups({ status? })` / `get_group_stops({ group_id })`
- `list_route_optimizations({ status? })`
- `get_trip_audit({ job_id, limit })`
- `verify_audit_chain({ job_id })`

### Security model

- RLS unchanged; all tools run as the calling coordinator via `requireSupabaseAuth`.
- Tool catalog is filtered by `company_feature_entitlements.copilot_read`.
- Prompt-injection defense: system prompt pins the tool contract, strips markdown links from tool outputs, and rejects any assistant text that appears to instruct future turns to bypass rules.
- PII: driver phone, pax contact, and portal tokens are redacted in tool outputs unless the coordinator has `has_role('coordinator_admin')`.
- Rate-limited to N asks/minute/user via `portal_rate_limits` pattern.

### Audit requirements

- Every `askCopilot` → row in `copilot_messages` (prompt, response, all tool calls with inputs/outputs).
- Session summary written to `ai_command_log` for backwards compatibility with the existing history UI.
- No writes to `trip_audit_log` in Phase 1.

### Risks

| Risk | Mitigation |
|---|---|
| Hallucinated trip IDs / driver names | Tool outputs are the only source; assistant must cite an id returned by a tool, else answer "I don't have that." |
| Prompt injection via chat messages / portal notes surfaced in tool output | Sanitize tool output; wrap user-generated strings in `<untrusted>` markers; system prompt forbids following instructions inside them. |
| Points blow-up from long context | Cap prompt+context at 8k tokens; summarize prior turns; hard-cap 6 tool calls per ask. |
| Sensitive data leakage in logs | Redact PII before persistence; encrypt `copilot_messages.content` at rest via existing pgsodium if enabled. |

### Rollback

- Feature flag `copilot_read` in `company_feature_entitlements` — flip off per company.
- Kill switch: `ai_configuration.copilot_enabled = false` disables the endpoint globally.
- Data is additive; drop `copilot_sessions` + `copilot_messages` + views to fully remove.

---

## Phase 2 — Action Copilot ("Do")

The Copilot proposes and, with approval, executes system actions. Extends the existing "Agent" mode of the Command Bar.

### Scope

Whitelisted actions (all already exist as serverFns — Copilot only orchestrates):
- `assign_driver`, `unassign_driver`, `reassign_driver`
- `reschedule_trip(date,time)`
- `set_status` (respects existing lock / change-request flow when driver has accepted)
- `create_group`, `add_to_group`, `remove_from_group`, `reorder_group_stop`
- `dispatch_to_partner`
- `send_trip_message(thread, body)` (coordinator/driver/passenger threads)
- `add_label` / `remove_label`
- `propose_price` / `accept_price_proposal`
- `start_wait_session_review` (open the coordinator review UI — no auto-charge)
- `request_route_optimization` (creates row in `group_route_optimizations`, coordinator still approves)
- `raise_emergency_override_review` (flags trip; never forces status itself)

Explicitly **not** in Phase 2: force status changes, mass cancellations, price acceptance without a proposal, anything touching billing or points beyond metering.

### Architecture

```
Ask/Agent chat
  → planCopilotActions serverFn
     → LLM returns array of tool_calls with args (JSON schema-validated)
     → returns { plan_id, actions[], preview[] }  ← no execution yet
  → UI renders plan with per-action checkboxes + diffs (before → after)
  → applyCopilotPlan({ plan_id, action_indices[] })
     → for each action: call the underlying serverFn under coordinator identity
     → write to trip_audit_log with actor_type='ai_assisted', actor_user_id=coord
```

- Reuses existing `applyAiCommandActions` machinery — Copilot is the new orchestrator, execution path is unchanged.
- Adds a **dry-run** step: every write tool has a `dry_run:true` sibling that returns the SQL-level diff without committing.

### Database requirements

- `copilot_action_plans` — plan_id, session_id, actions jsonb, previews jsonb, created_at, applied_at, applied_by, applied_indices int[].
- Extend `trip_audit_log`:
  - `actor_type` gains `'ai_assisted'` and `'ai_autonomous'` values (Phase 4).
  - `ai_plan_id uuid` nullable FK to `copilot_action_plans`.
- New `copilot_action_allowlist(company_id, action_name, enabled, requires_approval)` — company-configurable per action.

### APIs required

- `planCopilotActions({ session_id, prompt })` → `{ plan_id, actions, previews, warnings }`
- `applyCopilotPlan({ plan_id, action_indices, confirm_token })` → per-action results
- `rejectCopilotPlan({ plan_id, reason })`
- `listCopilotPlans({ status })` for the review inbox
- `updateCopilotAllowlist({ action_name, enabled, requires_approval })` (admin only)

### Security model

- Every action executes as the coordinator, so RLS + existing change-request lock logic still apply — the Copilot cannot bypass driver-approval flow.
- Destructive actions (mass unassign, dispatch to partner, cancel) require **explicit re-confirmation** (typed word or 2-tap) even if the allowlist marks them auto-approvable in future phases.
- CSRF-style `confirm_token` bound to plan_id + user session, TTL 5 min.
- Per-company throttle: max 20 applied actions per hour by Copilot in Phase 2.

### Audit requirements

- Plan creation, approval, per-action success/failure, and any errors persisted on the plan row.
- Each executed action inserts to `trip_audit_log` with hash-chain, `actor_type='ai_assisted'`, `ai_plan_id`, and the exact tool_input.
- Hash-chain verification tool (Phase 1) surfaces AI-executed events distinctly.

### Risks

| Risk | Mitigation |
|---|---|
| LLM proposes correct-looking but wrong action | Mandatory diff preview; per-action approval; plan expires in 5 min. |
| Race with concurrent coordinator edits | Optimistic concurrency: capture `jobs.updated_at` in preview, re-check at apply; abort action if changed. |
| Cascading side effects (assign triggers notifications, points, etc.) | Actions call existing serverFns — same side effects as manual, no new pathways. |
| Cost creep from replans | Cache last plan per prompt hash for 60s; refuse identical replans without new context. |

### Rollback

- `copilot_action_allowlist` set all rows to `enabled=false` disables writes company-wide.
- `ai_configuration.copilot_actions_enabled=false` disables globally.
- Applied actions are reversible via existing UI (reassign, reschedule) — Copilot never performs schema or ledger writes.

---

## Phase 3 — Proactive Copilot ("Notice")

The Copilot watches the board and surfaces recommendations without being asked.

### Scope

Signals monitored:
- Idle drivers with unassigned nearby trips → suggest assign.
- Trips with tight pickup windows given current ETA + traffic → suggest earlier dispatch or driver swap.
- Waiting sessions crossing free-window threshold → suggest price proposal.
- Route inefficiencies in same-group stops → suggest reorder / optimization request.
- Repeated safety events for a driver → surface for HR review.
- Flight delays > 60min on airport trips (already have `flight_status_snapshots`) → suggest reassign.
- Boarding approvals stuck > 10min → nudge passenger via portal.
- Points-ledger anomalies (unusual spend rate) → alert admin.

### Architecture

```
pg_cron every 60s → /api/public/cron/copilot-scan (per company)
  → run detector functions (SQL + light heuristics, NO LLM)
  → for each finding, LLM only formats the recommendation + citations
  → insert into copilot_recommendations
  → push to coordinator via existing web-push (driver_push_subs pattern)
UI: "Copilot suggestions" tray on dispatch board
  → Accept → creates a Phase 2 plan pre-filled with the recommended action
  → Dismiss → stored with reason for future tuning
```

- Detectors are deterministic SQL queries — cheap, explainable, unit-testable.
- LLM is only used to phrase the suggestion and rank a small candidate set.

### Database requirements

- `copilot_recommendations` — id, company_id, kind, subject_type (job/driver/group), subject_id, severity, message, suggested_action jsonb, expires_at, created_at, resolved_at, resolution ('accepted'|'dismissed'|'expired'), resolution_reason.
- `copilot_detector_config(company_id, kind, enabled, threshold_json)`.
- `copilot_recommendation_feedback(recommendation_id, coordinator_id, useful bool, note)` for tuning.

### APIs required

- `listCopilotRecommendations({ open_only? })`
- `acceptRecommendation({ id })` → returns a Phase 2 plan_id
- `dismissRecommendation({ id, reason })`
- `updateDetectorConfig({ kind, enabled, threshold_json })`
- Cron endpoint: `/api/public/cron/copilot-scan` (HMAC-signed, per public-api rules).

### Security model

- Cron endpoint verifies HMAC signature (existing pattern under `/api/public/cron/*`).
- Recommendations respect entitlement + RLS at read time — a coordinator only sees rows for their company.
- Detectors run as `service_role` inside a `SECURITY DEFINER` function that scopes by `company_id` — never returns cross-tenant data.

### Audit requirements

- Every recommendation and its resolution logged with actor (system or coordinator).
- If a recommendation leads to an accepted plan, `copilot_action_plans.origin_recommendation_id` links the two.

### Risks

| Risk | Mitigation |
|---|---|
| Alert fatigue | Per-coordinator + per-kind mute; severity-based batching; max N pushes/hour. |
| False positives from stale ETA | Detectors require ETA freshness < 5 min; else defer. |
| Cron overrun on large companies | Sharded scan (company batches of 20); per-run budget 10s; skip company if last run < 45s. |
| Coordinator becomes passive | UX shows dismissal reasons in weekly digest so managers see trends. |

### Rollback

- Disable all detectors: `UPDATE copilot_detector_config SET enabled=false WHERE company_id=…`
- Kill switch on the cron route.
- Recommendations are ephemeral (`expires_at`); dropping the table only loses history.

---

## Phase 4 — Autonomous Dispatch

The Copilot executes a narrow, explicitly-authorized set of routine actions without waiting for a coordinator.

### Scope (initial, deliberately small)

- Auto-assign a new pending trip to the best-fit online driver **when** confidence ≥ threshold **and** company has enabled `auto_assign_enabled` (already exists).
- Auto-request route optimization for a group when > N stops change (still requires coordinator to accept optimization — Phase 4 removes the "request" click, not the "approve" click).
- Auto-nudge passengers with pending boarding approvals via portal.
- Auto-close waiting sessions that were left open after status transitioned (already partly handled by `closeOpenWaitSession` — Phase 4 makes it AI-monitored and reports anomalies).

**Never autonomous:** price changes, cancellations, dispatch to partner, force status, emergency overrides, anything touching points beyond metering.

### Architecture

```
Same detector loop as Phase 3
  → if action.kind ∈ autonomous_allowlist AND confidence ≥ threshold:
       skip recommendation, create a plan with auto_apply=true
       apply immediately via applyCopilotPlan (system identity)
       write trip_audit_log actor_type='ai_autonomous'
       notify coordinator (info-level push)
  → else: fall back to Phase 3 recommendation
Circuit breaker:
  - If > X autonomous actions fail or get manually reverted in 1h, disable autonomy for that kind for 24h and alert admin.
```

### Database requirements

- `copilot_autonomy_policy(company_id, action_kind, enabled, min_confidence, daily_cap, quiet_hours tstzrange)`.
- `copilot_autonomy_events` — each autonomous action, confidence score, features jsonb, outcome, reverted_at.
- `copilot_circuit_breaker(company_id, action_kind, tripped_at, reason)`.
- Add `origin` enum to `copilot_action_plans` (`manual|assisted|autonomous`).

### APIs required

- `updateAutonomyPolicy({ action_kind, ... })` (admin only, requires re-auth).
- `listAutonomyEvents({ range, action_kind? })`
- `revertAutonomyEvent({ id })` — one-click undo where the underlying action is reversible.
- `tripCircuitBreaker({ action_kind })` / `resetCircuitBreaker`.

### Security model

- Autonomy runs under a dedicated Postgres role `copilot_agent` with grants limited to the whitelisted action serverFns.
- Every autonomous plan carries a signed `origin='autonomous'` marker; UI badges it clearly on every affected trip.
- Two-person rule to enable autonomy on a new action kind: admin proposes, second admin approves within 24h.
- Quiet hours enforced per company (default: no autonomous actions 22:00–06:00 local).

### Audit requirements

- Hash-chained audit entry with `actor_type='ai_autonomous'`, features + confidence recorded.
- Daily digest emailed to company admin listing all autonomous actions and their outcomes.
- Immutable weekly export to object storage for compliance.

### Risks

| Risk | Mitigation |
|---|---|
| Bad auto-assign chains cascading | Daily cap + circuit breaker + one-click revert; conservative confidence threshold (≥ 0.85) at launch. |
| Loss of coordinator trust | Every autonomous action pushes a passive notification and is visible in a dedicated "Autonomous log" panel; UX emphasizes reversibility. |
| Regulatory / labor concerns re: automated assignment | Policy is opt-in per company; admin sign-off required; audit export supports disputes. |
| Model drift | Weekly review of `copilot_autonomy_events` outcomes; auto-disable action_kind if revert-rate > 15%. |

### Rollback

- Global kill: `ai_configuration.autonomy_enabled=false`.
- Per-company: `copilot_autonomy_policy` all rows `enabled=false`.
- Per-action-kind: circuit breaker trip.
- Every autonomous action is reversible via the same serverFns coordinators already use.

---

## Cross-phase deliverables

- **Copilot Center** UI (evolves the existing AI Center): three tabs — Ask, Suggestions, Autonomy.
- **Points meter** per session and per phase, visible to admin.
- **Test harness**: fixture-based replay of prompts against the read-tool catalog; regression suite for Phase 2 planners; property tests for Phase 3 detectors.
- **Docs**: user-facing guide + internal runbook for the circuit breaker and rollback switches.

## Rollout order & exit criteria

1. Phase 1 GA → 2 weeks of usage, < 2% "wrong answer" reports from coordinators.
2. Phase 2 GA → 500 plans applied across pilot companies with < 1% reverted within 1h.
3. Phase 3 GA → recommendation acceptance ≥ 30%, dismissal-with-reason ≥ 60% of the rest.
4. Phase 4 pilot → single action kind (`auto_assign`) with 2 pilot companies, min 4 weeks before adding next kind.
