
## Problem

When you paste a real crew-change message, the assistant answers "I started extracting the trips, but the structured result was incomplete…" instead of showing trip cards. From `ai_raw_responses` there are two distinct causes, both landing on the same fallback error:

1. **Post-JSON prose (your last message).** Gemini returned a valid `{ "kind": "batch", "drafts": […] }` and then appended a second clarify sentence after the closing brace. Our `extractJson` balanced-brace scan only accepts a candidate if `JSON.parse` succeeds on it as-is, and it never tries the *first* balanced object alone when the tail is garbage. So a perfectly usable draft gets thrown away.
2. **Token truncation on longer pastes.** `max_tokens: 5000` is still being hit (`finish_reason: "length"`) on multi-trip emails; JSON ends mid-string and can't be parsed at all.

## Fix

All changes in `src/lib/coordinator-assist.functions.ts`. Frontend/UI unchanged.

1. **Salvage the first balanced JSON object.** In `extractJson`, when the balanced-brace scan finds candidates, try each in order (first one first) and return the first that parses. This already exists but currently the *last* candidate (`s.slice(first, last+1)`) is also pushed and tried before the balanced ones — reorder so balanced-scan candidates are tried first, so trailing prose after `}` no longer poisons a valid object.
2. **Add a light JSON-repair fallback** for `finish_reason === "length"`: if strict parse fails, attempt to (a) close any unterminated string, (b) close open arrays/objects by counting depth, then re-parse. If it yields `{ kind: "batch", drafts: [...] }` with at least one usable draft, return those cards with a small "⚠ Response was truncated — review carefully" note instead of the "send again" dead-end.
3. **Raise `max_tokens` to 12000.** Gemini 3.5 Flash easily supports it; the current 5000 is the practical bottleneck for 3+ trip pastes with pax lists.
4. **Better fallback message.** When we truly cannot recover anything, tell the user what actually happened (truncated vs unparseable) instead of blaming them.

## Out of scope
No changes to prompt, cost metering, `toDraft`, pax extraction, or the UI. This is a parser/robustness pass only.

## Verification
- Re-send your exact 5-crew message → expect 2 trip cards (MMH → Cerviola today ~12:00, Cerviola → Airport tomorrow 08:00) with 5 pax each.
- Query `ai_raw_responses` after the retry to confirm `parse_ok = true`.

## Question for you
For point #2 (salvage truncated JSON): do you want to **auto-surface** the partial cards with a warning, or would you rather the assistant **auto-retry once** with a shorter/summarized prompt when it hits `length`? Auto-surface is faster and cheaper; auto-retry costs a second AI call but gives a complete result. I'd default to auto-surface unless you say otherwise.
