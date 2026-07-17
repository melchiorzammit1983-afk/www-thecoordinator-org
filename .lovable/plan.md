
# AI That Learns From Everyone (Safely)

Turn the Guide + extraction + suggestion AIs into a system that gets smarter every time a company or coordinator teaches it — while keeping personal data out of the shared brain and reminding users to verify every answer.

## The three learning layers

```text
┌──────────────────────────────────────────────────────────┐
│  GLOBAL BRAIN  (approved by platform admin)              │
│  • Parsing patterns (hotel email formats, WhatsApp)      │
│  • Q&A knowledge ("how does X work")                     │
│  • Signal → fix mappings                                 │
│         ↑ promoted after PII strip + admin approval      │
├──────────────────────────────────────────────────────────┤
│  COMPANY BRAIN  (private to one company)                 │
│  • Pricing rules, preferred drivers, shorthand           │
│  • Company-specific hotel/venue aliases                  │
│  • Coordinator playbook ("we always confirm 2h ahead")   │
│         ↑ auto-captured from edits + explicit teach      │
├──────────────────────────────────────────────────────────┤
│  BEHAVIOR SIGNALS  (aggregated, anonymized)              │
│  • Accepted vs rejected suggestions                      │
│  • Extraction fields the user corrected                  │
│  • Guide answers rated 👎                                │
└──────────────────────────────────────────────────────────┘
```

## What we'll build

### 1. Data model (new tables)
- `ai_lessons` — one row per taught pattern. Columns: `id`, `kind` (`parse_pattern | qa | suggestion_rule | signal_fix`), `scope` (`company | global`), `company_id`, `title`, `example_input_redacted`, `rule_text`, `embedding vector(1536)`, `status` (`pending | approved | rejected | archived`), `submitted_by`, `approved_by`, `usage_count`, `success_rate`, `created_at`.
- `ai_lesson_feedback` — thumbs up/down + free-text correction from any AI surface. Feeds the review queue.
- `ai_lesson_share_settings` (per company) — two toggles: `contribute_to_global`, `consume_global`.
- `ai_pii_audit` — every redaction pass logs what was stripped (type + count only, never the value) so admins can prove compliance.

RLS: company brain readable only by that company's members; global brain readable by any company that opted-in; write to global requires platform admin.

### 2. Three ways users teach the AI

**a. Thumbs + correction (every AI output)**
Add a compact `<AiFeedback />` component under every extraction card, Guide answer, and coordinator suggestion. 👎 opens "what was wrong?" with a suggested fix field.

**b. Explicit "Teach the AI" button**
On the extraction preview and Guide, a button opens a dialog: paste the raw message, describe the rule ("pax count is in brackets after passenger name"). Company admin sets scope (company only vs propose to global).

**c. Silent auto-learn from edits**
When a coordinator edits an AI-extracted trip, we diff the AI output vs the saved trip and queue a candidate lesson. If the same correction appears 3+ times, it auto-promotes to a company lesson.

### 3. PII stripping (mandatory before storage)
Every submitted example goes through a two-stage redactor before it ever touches the `ai_lessons` table:
- Regex sweep: emails, phones (E.164 + local Malta), flight numbers, IBANs, license plates, credit-card patterns.
- LLM redaction pass (Gemini flash-lite): replaces person names, exact addresses, hotel guest identifiers with `<NAME>`, `<ADDRESS>`, `<GUEST_ID>` placeholders — pattern shape preserved so parsing still learns.
- Reject if any 4+ digit sequence survives that isn't a time/date.
- Log to `ai_pii_audit`.

### 4. Admin curation queue (`/admin/ai-lessons`)
- Tabs: **Pending global** / **Company approved** / **Rejected** / **All**.
- Each card shows redacted example, proposed rule, submitting company, similar existing lessons (via embedding search), usage stats.
- Actions: Approve → global, Approve → company only, Edit rule, Reject with reason, Merge with existing lesson.
- Bulk approve for obviously-safe patterns.

### 5. Retrieval at inference time
Before every AI call (extraction, Guide, suggestion) we run a vector search:
1. Company lessons matching the input (always included if company opted-in to contribute).
2. Global lessons matching the input (included only if company opted-in to consume).
3. Top 5 are injected into the system prompt as "Learned patterns to apply".
Embeddings via `openai/text-embedding-3-small` through the gateway; stored in `ai_lessons.embedding`.

### 6. Persistent safety UI (already partial, we'll complete)
- Update `AskGuidePanel` footer disclaimer from tiny text to a visible banner: **"AI answers can be wrong. Always verify before acting on payments, driver assignments, or passenger info. Personal data is never shared between companies."**
- Same banner in extraction preview, coordinator suggestions, and the Teach dialog.
- Every AI response ends with a subtle "Was this helpful?" bar including the verify reminder.

### 7. Company settings page (`/coordinator/ai-learning`)
- Two clear toggles with plain-language explanations.
- Table of lessons taught by this company (with edit/archive).
- Table of global lessons currently active for this company.
- "See what data we would share" preview button — shows the redacted example that would leave the company.

## Technical details

**New files**
- `supabase/migrations/*_ai_lessons.sql` — 4 tables + RLS + `match_ai_lessons(embedding, company_id, kind)` RPC.
- `src/lib/ai-lessons.functions.ts` — `submitLesson`, `voteLesson`, `listPendingLessons`, `approveLesson`, `rejectLesson`, `searchRelevantLessons`, `setShareSettings`.
- `src/lib/ai-pii.server.ts` — regex + LLM redactor + audit logger.
- `src/lib/ai-context.server.ts` — helper called by every AI route: `buildLearnedContext(companyId, kind, input) → string` injected into system prompt.
- `src/components/ai/AiFeedback.tsx` — thumbs + correction UI.
- `src/components/ai/TeachAiDialog.tsx` — explicit teach flow.
- `src/components/ai/SafetyBanner.tsx` — reused across surfaces.
- `src/routes/_authenticated/admin.ai-lessons.tsx` — curation queue.
- `src/routes/_authenticated/coordinator.ai-learning.tsx` — company settings.

**Files updated**
- `src/routes/api/help-chat.ts` — inject `buildLearnedContext` into system prompt; append `AiFeedback` metadata to log rows.
- `src/lib/help-ai.server.ts` — extend system prompt with `## Learned patterns` section + hardened safety instruction ("Never repeat personal names, phone numbers, or addresses from one conversation into another. Always end answers with 'verify before acting'.")
- Extraction pipeline in `src/lib/parse-trips.ts` and the bulk-understand path — call `buildLearnedContext('parse_pattern', ...)` and log corrections when coordinator edits before saving.
- `AskGuidePanel.tsx` — swap the tiny disclaimer for the visible `SafetyBanner`.
- `src/lib/docs-facts.ts` — no change (still ground truth for constants).

**Safety invariants (unit-tested)**
- No lesson row can be inserted without passing the PII redactor.
- Global scope requires `approved_by IS NOT NULL AND approver has platform_admin role`.
- Company A can never read Company B's `ai_lessons` rows (RLS test).
- Redaction audit logs never store raw values.

## Rollout order
1. Migration + RLS + share-settings table.
2. `AiFeedback` component + logging (no learning yet — just collect data).
3. PII redactor + `TeachAiDialog` + submission flow.
4. Admin curation queue.
5. Retrieval integration into Guide first, then extraction, then suggestions.
6. Company settings page + safety banners everywhere.

## Open choices for you
- **Auto-promote threshold**: after how many identical coordinator corrections should a company lesson auto-activate? Default suggestion: 3.
- **Global approval**: only you (platform owner) approve, or delegate to trusted "curator" role? Default: only platform admins.
- **Points cost**: should teaching the AI cost points, be free, or *earn* points as a thank-you? Default: free to teach, small reward when your lesson gets promoted to global.

Reply with your preferences on those three and I'll build.
