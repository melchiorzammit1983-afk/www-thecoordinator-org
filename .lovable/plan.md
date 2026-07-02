## Goal
When a passenger row is just a phone number, emoji, or empty text, remove it from the passenger list instead of keeping a blank pax. Move the phone into the trip's phone-number field (already partly working) and make sure the cleanup runs on both new entries and existing trips.

## Problem observed
In the selected trip, pax rows are showing as:
- `⬅️`
- `⬅️ +39 320 4192957`
- `⬅️ FLORIO Michele`

Expected after cleanup: **1 passenger** (`FLORIO Michele`) and `+39 320 4192957` in the Phone number field.

Today `normalizeJobData` extracts the phone but only trims the name — it keeps rows whose "name" is empty or just an emoji/arrow, so blank pax remain visible.

## Changes

### 1. `src/lib/parse-trips.ts`
- Add a shared `isMeaningfulName(s)` helper: after stripping phones, emojis, arrows, punctuation and whitespace, a name is meaningful only if it still contains at least one letter (unicode letter class).
- Update `extractPhoneFromName` to also strip leading/trailing arrow glyphs (`⬅️ ➡️ → ← -> <-`) and repeated punctuation from `cleanName`.

### 2. `src/lib/coordinator.functions.ts` — `normalizeJobData`
- For each pax row:
  - Extract the phone (as today) → if found and job has no `contact_phone`, set it.
  - If cleaned name is **not meaningful** (empty / only symbols / only a phone), `DELETE` that pax row.
  - Otherwise, if the cleaned name differs from stored, `UPDATE` the row.
- Keep flight-code normalization untouched.
- Return `{ removed, updated, phoneMoved }` for a clearer toast.

### 3. `src/components/coordinator/JobFormDialog.tsx` — `PaxEditor`
- On add, if the input reduces to a non-meaningful name after phone extraction, do **not** create the pax row — only save the phone (and toast "Saved phone number"). Prevents creating new blank rows.

### 4. `src/components/coordinator/TripDetailsSheet.tsx`
- The existing auto-run of `normalizeJobData` on open will now also invalidate `["job-pax", jobId]` so the pax list refreshes after cleanup.
- Toast text updated to reflect removals: e.g. "Cleaned 2 blank passenger rows · Moved phone number".

### 5. `src/lib/parse-trips.ts` — bulk paste parser
- Skip pax lines that are non-meaningful after phone extraction, so pasting a WhatsApp block with a stray phone-only line doesn't create empty pax.

## Non-goals
- No schema changes.
- No changes to driver-facing screens (they'll reflect the cleaned pax automatically).
- No UI redesign of the Edit trip dialog.
