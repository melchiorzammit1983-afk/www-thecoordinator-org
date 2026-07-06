## Problem

`runAiCommand` in `src/lib/coordinator.functions.ts` (~line 3876) only loads jobs where `company_id = your company`, capped at the last day and 120 rows, with a very thin field list. The dispatch board's `listJobs` (~line 222) loads much more: trips your company owns, executes, originated, or sits in the dispatch chain of. So partner-dispatched cards visible on the board are invisible to the AI, and "no jobs" is the honest answer to its narrow query. On top of that the AI can't message drivers/clients, and there's no explicit confirm-before-act contract.

## Fix

### 1. Read the same trips the board reads

In `runAiCommand`, replace the current jobs query with the same OR filter used by `listJobs`:

```
company_id.eq.{c.id}
executor_company_id.eq.{c.id}
origin_company_id.eq.{c.id}
dispatch_chain_company_ids.cs.{{c.id}}
```

Also widen the window: `date >= yesterday AND date <= today+30`, limit 500 (was 120, yesterday-only).

### 2. Give the AI the full card context

Extend the SELECT to include every field the board card renders, then format each row in the prompt with these fields:

- Flight: `from_flight`, `to_flight`, `flight_scheduled_at`, `flight_estimated_at`, `flight_status`, `flight_status_note`
- Group + labels: `group_id`, `group_name`, `grouped_count`, `job_labels(trip_labels(name))`
- Company + dispatch: `company_id`, `executor_company_id`, `origin_company_id`, `dispatch_status`, `dispatch_chain_company_ids` (resolved to company names in a single lookup)
- Client + pax: `clientcompanyname`, `contact_phone`, `pax(name)`, plus the existing `name`/`surname`
- Existing: id, from/to, date, time, pickup_at, driver, status

Also load the caller's connected partner companies (for dispatch actions) and the currently open `trip_messages` threads per job (for messaging).

### 3. Turn the AI into a confirm-first agent

Change the action contract so **every** action is a proposal, not an auto-execute. Return shape becomes:

```
{ response: "markdown", actions: [ ... ], requires_confirmation: true }
```

`mode: "execute"` no longer means "run now"; it means "propose actions the user can approve". Current auto-run for ≤5 actions is removed — the UI must always show the proposed actions with an Approve / Reject button before anything hits the DB. The 5-action `awaiting_confirm` path becomes the only path.

Add new action types on top of the existing `assign | unassign | reschedule | note`:

- `status` — set trip status (completed, cancelled, no_show, etc.)
- `group` / `ungroup` — merge/split trips into a group
- `dispatch` — send a trip to a connected partner company (routes through the existing dispatch flow, points-metered)
- `message` — post a message into an existing `trip_messages` thread (driver_coord or client_coord), from the AI on behalf of the coordinator

Each executor branch already exists elsewhere in `coordinator.functions.ts` (assign/reschedule/status changes, group create, dispatch to partner, `postTripMessage`); the AI executor reuses those code paths instead of raw table updates so the existing rules (partner-must-accept, private-thread rewrites, points spend, driver notification) still fire.

### 4. New "apply proposed actions" server function

Add `applyAiCommandActions({ command_log_id, action_indices[] })` that:

- Reads the stored `ai_command_log` row for the current company
- Re-validates every action against the current DB state (ids, ownership, driver availability, partner-accept state, points balance)
- Runs each accepted action through the existing helpers listed above
- Writes back `executed_actions`, `affected_count`, `applied_at` to the log row
- Returns a per-action result list so the UI shows ✓ / ✗ inline

Also add columns to `ai_command_log`: `requires_confirmation boolean`, `applied_at timestamptz`, `executed_actions jsonb`, `affected_count int`.

### 5. UI (`src/routes/_authenticated/coordinator.ai-center.tsx`)

- Under each history entry with actions, render an action list with checkboxes (all checked by default) and an **Approve selected** button → calls `applyAiCommandActions`.
- Show partner-name + dispatch chain + flight status inline per proposed action so the coordinator can see what will happen.
- After apply, replace the block with per-row ✓/✗ and the affected count.
- Add a small "Read cards" toggle above the input that's on by default and, when off, restricts the AI to the old owned-only scope (satisfies "if the user told the AI to start reading the cards, he will change to read the cards").

### 6. System prompt updates

- Tell the model it's an agent for a coordinator + driver mind, and that **every action needs coordinator confirmation** — never claim something was done, always propose.
- Document each of the 8 action types (`assign | unassign | reschedule | status | group | ungroup | dispatch | message | note`) with required fields.
- Instruct: "If the user asks to message a driver/client, propose a `message` action with `thread='driver_coord'|'client_coord'` and `body='...'` and wait for approval."

### Migration

One migration adds:
- `ai_command_log.requires_confirmation boolean default true`
- `ai_command_log.applied_at timestamptz`
- `ai_command_log.executed_actions jsonb`
- `ai_command_log.affected_count int`
- Seed rows in `ai_feature_costs` for `ai_agent_message` (1 pt) and `ai_agent_dispatch` (1 pt) so messaging/dispatch actions are metered.

## Files touched

- `src/lib/coordinator.functions.ts` — widened jobs query, richer context, agent contract, new `applyAiCommandActions`, new action executors reusing existing helpers.
- `src/routes/_authenticated/coordinator.ai-center.tsx` — proposal UI with Approve selected + per-action results + "Read cards" toggle.
- One SQL migration for `ai_command_log` columns and two `ai_feature_costs` rows.

## Explicit non-goals

- No auto-execute. Even a single-action response requires the coordinator to press Approve.
- No new AI-only tables — reuse `trip_messages`, `jobs`, `job_dispatch_hops`.
- No changes to driver-facing UI or the private-thread rules from the earlier fix.
- No timezone / flight logic changes — those are already done.
