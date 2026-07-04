# Reduce AI usage for "Understand with AI"

Goal: make the Paste-bulk AI feature use as few tokens as possible while keeping quality good for messy WhatsApp/email pastes.

## Changes

### 1. Switch model → `gemini-2.5-flash-lite`
File: `src/lib/coordinator.functions.ts` (`extractTripsFromText` handler)
- Change endpoint URL from `models/gemini-2.5-flash:generateContent` to `models/gemini-2.5-flash-lite:generateContent`.
- Roughly 5–8× cheaper per token than `gemini-2.5-flash`, still strong for structured extraction. Uses your existing `GEMINI_API_KEY`, so it stays off Lovable credits.

### 2. Trim the system instruction (~40% shorter)
Same handler.
- Collapse the 20-line prompt to a compact version that keeps only the 8 keys, the flight/airport rule, the missing-info rule, and the JSON output shape. Drop repeated examples and filler.

### 3. Cap `maxOutputTokens`
Same handler, in `generationConfig`.
- Add `maxOutputTokens: 512`. Enough for ~10 trips of JSON; prevents runaway responses.

### 4. Cap chat history sent to Gemini
Same handler.
- Keep only the last 4 messages (`data.messages.slice(-4)`) instead of up to 20. Follow-ups only need the recent turns.

### 5. Skip the AI entirely for spreadsheet pastes
File: `src/components/coordinator/JobFormDialog.tsx` (`BulkForm`)
- In `startAi`, if `looksLikeSheetPaste(raw)` is true, don't call the AI — just show a toast ("Looks like sheet data — parsed directly") and let the existing `parseSheetPaste` render staged rows. Zero tokens spent.

## Out of scope
- Switching provider (staying on your direct Gemini key).
- Changing the chat-UI mini-conversation flow.
- Changing how AI-returned rows feed into `parseSheetPaste`.

## Expected effect
- Typical WhatsApp paste: ~70–85% fewer input tokens per call (shorter prompt + shorter history), ~5× cheaper per token (Flash-Lite), capped output.
- Excel/Sheets paste: 100% cheaper (no AI call).
