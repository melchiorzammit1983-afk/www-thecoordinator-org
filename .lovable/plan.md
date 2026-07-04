# Multimodal inputs for "Understand with AI"

Let the coordinator drop a file, paste a link, or attach a photo into the Paste-bulk chat. The AI treats itself as a data-extraction coordinator and returns the same `{type:"question"}` / `{type:"data"}` shape it already does — so nothing downstream changes.

## Accepted inputs

- **Images** (JPG/PNG/WebP/HEIC) — screenshots of WhatsApp, emails, tickets, boarding passes.
- **PDFs** — booking confirmations, itineraries.
- **Excel/CSV** (.xlsx, .xls, .csv) — parsed locally with the existing `parseSheetPaste`; **no AI call**.
- **Links** (public URLs) — backend fetches the page and feeds cleaned text to the AI.
- Limits: **max 5 attachments per message, 10 MB each**, images + PDF only for the AI path. Enforced client-side and re-checked server-side.

## Backend (`src/lib/coordinator.functions.ts`)

Extend `extractTripsFromText`:

- Rename kept, but the input schema gains optional fields:
  - `attachments?: { name: string; mimeType: string; dataBase64: string }[]` (max 5, each ≤ 10 MB, only `image/*` or `application/pdf`).
  - `urls?: string[]` (max 3, `http(s)` only).
- **Model routing**: if `attachments.length > 0` OR `urls.length > 0` → use `gemini-2.5-flash` (better OCR / longer context). Otherwise keep `gemini-2.5-flash-lite`. Bump `maxOutputTokens` to `1024` when files/urls are present.
- **URL fetch**: for each URL, `fetch` with a 6 s timeout, cap body at 200 KB, strip `<script>/<style>`, collapse whitespace, and prepend a `From <hostname>:` label to the text sent to Gemini. Fetch failures become a short note in the prompt, not an error.
- **Multimodal body**: build Gemini `contents` as before, but append `inline_data` parts for each attachment `{ mime_type, data }` and a text part for each fetched URL body on the latest user turn.
- Tighten the system instruction one line: "You are a transport-coordinator data extractor. Sources may be text, images, PDFs, or web pages."
- Keep the JSON output contract unchanged so the frontend mapping to `parseSheetPaste`-style rows still works.

## Frontend (`src/components/coordinator/JobFormDialog.tsx` → `BulkForm`)

- Add an **Attach** button (paperclip icon) next to "Understand with AI". Opens a hidden `<input type="file" multiple accept="image/*,application/pdf,.xlsx,.xls,.csv">`. Also support drag-and-drop onto the textarea and clipboard image paste (`onPaste` → `DataTransferItemList`).
- **Local routing before any AI call** in `startAi`:
  1. If any dropped file is `.xlsx/.xls/.csv` → read it with the existing `xlsx` lib, convert to the same tab-separated string `parseSheetPaste` already accepts, stage rows, done. Zero tokens.
  2. Else if the pasted text `looksLikeSheetPaste` → existing local path (already there).
  3. Else → collect URLs from the textarea (simple regex) + attachments, base64-encode files client-side, call `extractTripsFromText` with `{ messages, attachments, urls }`.
- Attachment chips render above the textarea with filename, size, and a remove (×) button. Show a small "Analyzing image/PDF…" hint while pending.
- Clear attachments after a successful `type:"data"` response (same trigger as clearing the textarea today). Keep them on `type:"question"` so follow-ups still have the source.
- Client-side validation: reject > 10 MB per file, > 5 files total, and unsupported MIME types with a toast.

## Out of scope

- Persisting uploads to storage — everything stays in-memory / base64.
- Login-protected URLs (documented limitation; toast if fetch returns 401/403).
- Changing the JSON contract or how staged rows feed into the trip creation flow.

## Expected effect

- Photo of a WhatsApp booking → trips staged automatically.
- PDF itinerary → trips staged automatically.
- Excel drop → parsed locally, still zero AI cost.
- Public booking link → fetched + extracted server-side.
