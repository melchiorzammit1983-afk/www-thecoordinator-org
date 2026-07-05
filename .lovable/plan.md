# Security & Error-Handling Audit: AI + B2B Collaboration

Two files, three targeted hardening passes. No behavior change to happy paths — only more graceful degradation under messy input and race conditions.

## 1. `src/lib/coordinator.functions.ts` — AI handlers

### `extractTripsFromText` (lines 2356–2511)
**Problem today:** the response is parsed with `JSON.parse` + ad-hoc `String(r?.x ?? "")` coercion. If Gemini drops a key, we get empty strings; if it returns a partially-shaped envelope (no `type`, or `payload` as string instead of array), we throw `AI returned unexpected shape` and lose the whole call (points already spent).

**Changes:**
- Introduce a shared Zod schema module (inline, at top of AI section):
  ```ts
  const tripRowSchema = z.object({
    pickupDate: z.string().default(""),
    pickupTime: z.string().default(""),
    pickupAddress: z.string().default(""),
    deliveryAddress: z.string().default(""),
    customerName: z.string().default(""),
    contactNumber: z.string().default(""),
    transportType: z.string().default(""),
    quantity: z.string().default("1"),
  }).passthrough().transform(r => ({ ...r, quantity: r.quantity || "1" }));

  const aiEnvelopeSchema = z.union([
    z.object({ type: z.literal("question"), payload: z.string().min(1).max(500) }),
    z.object({ type: z.literal("data"), payload: z.array(z.unknown()) }),
  ]);
  ```
- Replace the manual `parsed?.type` branching with `aiEnvelopeSchema.safeParse(parsed)`. On failure, fall back to best-effort recovery: if `parsed.payload` is an array, treat as data; if it's a string, treat as question; otherwise throw a friendly `"AI response was unreadable — please rephrase and try again"` (no raw shape leaking).
- Each row → `tripRowSchema.safeParse(r)`; skip only rows where `success===false` AND no fields recoverable, instead of failing the batch.
- Tighten system prompt (line 2440–2447): add explicit fallback instruction:
  > "Return ALL 8 keys for every row. If a value is unknown, use empty string `""` (or `"1"` for quantity) — never omit a key. If mandatory pickup fields cannot be inferred, use the question envelope instead of a partial data row."

### `callGemini` (line 3031)
**Problem today:** any JSON parse failure throws `"AI returned invalid JSON"` and callers have no way to retry with a stricter reminder.
**Changes:**
- Wrap the `JSON.parse` in try/catch that first attempts a fenced-code recovery (strip ` ```json … ``` ` wrappers Gemini occasionally emits despite `responseMimeType: json`).
- On 5xx from Gemini, do one automatic retry after 400ms.
- Add optional `schema?: z.ZodSchema` param; when supplied, run `safeParse` and return `{ data, warnings: string[] }` shape so callers can distinguish "bad shape" from "bad transport".

### `aiVoiceNoteToTrip` (line 3282)
**Problem today:** same brittle `String(r?.x ?? "")` coercion; no size/duration guardrails beyond byte cap; `spendOrThrow` runs BEFORE Gemini, so a Gemini 5xx leaves the user charged with no result.
**Changes:**
- Reuse `tripRowSchema` + a `voiceEnvelopeSchema = z.object({ transcript: z.string().default(""), trips: z.array(z.unknown()).default([]) }).passthrough()`.
- Extend the prompt to require the same "always return all 8 keys, empty string for unknowns" rule.
- Wrap the Gemini fetch in try/catch; on any failure AFTER spend, refund via a new small helper `refundPoints(companyId, feature, note, jobId?)` calling `sb.rpc("spend_points", { ..., _cost_override: -N })`. If refund RPC not available, log a `console.warn` (still return the user-facing error). Keep the current "empty trips" toast path as-is.
- Add explicit `if (!text) throw new Error("AI returned an empty transcript — recording may be silent")` before parse.

## 2. `src/lib/collab.functions.ts` — B2B hop concurrency

### The race
Recall (creator side) and accept/reject (partner side) both read the "latest pending hop" and update `jobs`. Two scenarios today:
1. Partner accepts at the same moment creator recalls → recall deletes the hop AFTER partner updated `status=accepted`; job ends up with `executor=creator` but no pending hop, silently orphaning the acceptance.
2. Partner accepts twice from two tabs → both pass the pending check, second UPDATE overwrites with the same values but spends `dispatch_decided_at` again (minor) — the real risk is if we later add side effects here.

### Changes
- **Guard the mutating UPDATE with a `.eq("status", "pending")` filter** (optimistic concurrency) in all three handlers:
  - `respondToDispatch`: change the hop UPDATE to include `.eq("id", hop.id).eq("status", "pending")` and use `.select("id")` so we can detect zero rows. If zero rows updated → throw a friendly `"This hand-off was already resolved — refresh to see the latest state"`.
  - `recallPartnerDispatch`: change the hop DELETE to `.eq("id", latest.id).eq("status", "pending").select("id")`. If zero rows → `"The partner already responded — recall no longer possible"`.
  - `dispatchJobToPartner`: after the hop insert, wrap the `jobs.update` with a precondition `.eq("dispatch_status", job.dispatch_status ?? null)` on the previous value (read one extra column earlier). On zero rows → roll back by deleting the just-inserted hop and throw `"Trip state changed — please retry"`.
- **Wrap each handler body in try/catch** around the state-mutation section (hop write → job write). If the second write fails, attempt a best-effort compensation (delete inserted hop / restore previous `dispatch_status`) and rethrow with a clear message. Catch-all fallback: `"Couldn't complete the hand-off — no changes were saved"`.
- **Standardize error messages** (short, user-facing, no DB error leakage). The message strings above are what will surface in the existing `toast.error(e.message)` handlers in the UI — no client changes needed.

## Out of scope (explicitly not touched)
- No changes to `aiAutoCoordinate` / `applyAutoCoordinateProposal` (already validates IDs against known sets).
- No DB migration. Concurrency is enforced with `.eq()` preconditions on existing columns; no advisory locks or triggers added.
- No client/UI changes — existing toasts render the new error strings.
- No changes to points pricing or `spend_points` RPC.

## Technical notes
- All schema additions are local `z.` declarations in `coordinator.functions.ts`; no new exports, no shared file.
- `refundPoints` helper is defined near `spendOrThrow` in the same file, private.
- Zero-row detection uses PostgREST `.select("id")` after mutation and checks `data?.length`, avoiding a second round-trip.
- Prompt changes only affect Gemini calls, not stored data.

## Files touched
- `src/lib/coordinator.functions.ts` (extractTripsFromText, callGemini, aiVoiceNoteToTrip, +refundPoints helper)
- `src/lib/collab.functions.ts` (dispatchJobToPartner, recallPartnerDispatch, respondToDispatch)
