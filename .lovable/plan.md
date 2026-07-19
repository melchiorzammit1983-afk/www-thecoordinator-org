## Goals

1. Let admins author lessons that reach every company (via the existing global-lesson retrieval pipeline).
2. Fix bulk-paste / AI extract so parsed names actually land in the passenger list (both `pax` rows and `jobs.pax_name` + `pax_count`).

---

## 1. Admin "Teach the Global AI" — extend `admin.ai-lessons`

Reuse the existing `ai_lessons` table + `match_ai_lessons` RPC. Admin-authored entries are inserted directly as `scope='global'`, `status='approved'` so they show up for every company's assistant/parser via the retrieval already wired in `src/lib/ai-context.server.ts`.

- **Server (`src/lib/ai-lessons.functions.ts`)**: add `adminCreateGlobalLesson` (admin-guarded). Fields: `kind` (parse_pattern | qa | suggestion_rule | signal_fix), `title`, `example_input`, `rule_text`. On insert: PII-redact `example_input`, embed `rule_text` via `embedText`, store `scope='global'`, `status='approved'`, `company_id=null`, `created_by=admin.uid`.
- **UI (`src/routes/_authenticated/admin.ai-lessons.tsx`)**: add a top card "Teach the global AI" with the same 4 fields as `TeachAiDialog`, a "Save global lesson" button, and a live PII-preview line (reuse `redactPii`). Keep the existing review queue below.
- Global lessons already flow into every AI surface because `buildLearnedContext` and assistant prompts pull from `ai_lessons` where `scope='global' AND status='approved'`.

No schema migration required (columns already exist).

---

## 2. Fix "names → passenger list" in JobFormDialog bulk paste

Two gaps today:

- **Server** `src/lib/coordinator.functions.ts` bulk-create loop (~line 2033): inserts `pax` rows but never writes `jobs.pax_name` / `jobs.pax_count`. Fix: after computing `t.pax`, set on the job insert:
  - `pax_name`: first name (or `pax.join(", ")` truncated to column limit)
  - `pax_count`: `t.pax.length || 1`
- **AI extract path** in `JobFormDialog.tsx` (`aiInitialOutput` → `AiRow`): confirm the AI row's `pax` array is carried through `handleComplete`/`edited` into the mutation payload. Where the AI returns names inside `notes` / `contact_name` instead of `pax[]`, promote them: post-process each `AiRow` to move meaningful names (via `isMeaningfulName`) into `pax[]` before it reaches `edited`.
- **Manual single-trip path** (~line 316): same treatment — `paxText` already splits into names; also set `pax_count = pax.length` and `pax_name = pax[0]` on the create payload.
- Add a small "Passengers (N)" chip on each parsed-trip card so the coordinator sees the parse succeeded before saving.

---

## 3. Verify

- Admin: create a global lesson → sign in as a different company → send an assistant message that matches the example → confirm the rule appears in the injected `LEARNED PATTERNS` block (server log) and influences the reply.
- Coordinator: paste a message containing 2–3 names → BulkForm shows Passengers chip with those names → Save → open the created job → `pax` table has rows AND `jobs.pax_name` / `pax_count` populated.

---

### Technical notes

- Admin guard: reuse `has_role(auth.uid(), 'admin')` check pattern already used elsewhere in `ai-lessons.functions.ts`.
- Embedding failures must not block insert (mirror existing `submitLesson` behavior).
- `pax_name` is a text column — no length constraint issue; still cap at 500 chars defensively.
- No changes to workflows, no new tables, no RLS changes.
