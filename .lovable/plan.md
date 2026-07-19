## Goal
Let coordinators send longer AI inputs than the current hard cap. Up to a free character threshold it stays free. Beyond it, extra characters are billed at a per-character price (points). Each company admin can override the platform default. If the company has no credits, the input is truncated to the free threshold and the user is warned.

## What changes

### 1. Database (migration)
- Extend `ai_configuration` (or add per-company row via `company_ai_rules`) with:
  - `free_char_threshold` (int, default 1000)
  - `overage_price_per_char` (numeric, default 0.01 points)
- Add `company_ai_overage_settings` table (per-company override):
  - `company_id`, `free_char_threshold`, `overage_price_per_char`, `enabled`, `updated_by`, `updated_at`
  - RLS: company admins read/write their own row; platform admin reads/writes all; GRANTs for authenticated + service_role.
- Extend `ai_command_log` / `driver_ai_usage` (whichever tracks assistant spend) with `chars_billed` and `overage_points` for audit.

### 2. Server: coordinator assistant (`src/lib/coordinator-assist.functions.ts`)
- Raise Zod cap on `message` to 200k and history entries to 200k (schema no longer the gate; billing is).
- Before calling the model:
  1. Compute `total_chars = message.length + sum(history[].text.length)`.
  2. Resolve effective `{free_threshold, price_per_char}` = company override ?? global default.
  3. `overage_chars = max(0, total_chars - free_threshold)`.
  4. `cost_points = overage_chars * price_per_char`.
  5. Check company wallet balance via existing points ledger.
     - If sufficient: deduct `cost_points`, log to `ai_command_log` with `chars_billed` + `overage_points`, proceed.
     - If insufficient: truncate history (oldest first) then message tail until `total_chars <= free_threshold`, add a system notice string returned to client (`truncated: true, reason: 'insufficient_credits'`), proceed with free call.
- Same wrapper applied to other AI entry points that accept long input (bulk trip extract, watchtower analyze) — reuse a shared `chargeCharOverage()` helper in `src/lib/ai-billing.server.ts`.

### 3. Admin UI
- **Platform admin** (`/admin/ai` or existing AI Center admin tab): add "Overage pricing" card — inputs for global free threshold + price per char, save button.
- **Company admin** (existing coordinator settings/pricing area): add "AI overage" card with same two inputs plus an "Enabled" toggle; when disabled falls back to global default. Show current wallet balance + estimated cost per 1000 chars overage as helper text.

### 4. Client UX
- Assistant composer: remove/raise the client-side maxLength; show live char counter that turns amber past threshold with tooltip: "Extra characters cost X points each (~Y points for this message)".
- On truncation response from server, show a toast: "Message shortened to free limit — add credits to send longer prompts" with a link to top-up.

### 5. No workflow changes
- Watchtower, bulk entry, and non-assistant flows keep working; billing only applies when `total_chars > free_threshold`.
- If AI is disabled for the company (existing entitlement gate), this feature is inert.

## Technical notes
- Points deduction reuses existing `points_ledger` + `driver_ai_usage`/`ai_command_log` patterns — no new billing engine.
- All price/threshold reads happen inside server handlers (never trust client-supplied cost).
- Truncation strategy: drop oldest history messages first, keep the newest user message intact if it alone fits; otherwise trim its tail with an ellipsis marker.
- Default global values: 1000 free chars, 0.01 points/char (matches your example).

## Out of scope
- Tiered brackets, per-user (not per-company) overrides, hard-block mode. Can be added later behind the same helper.
