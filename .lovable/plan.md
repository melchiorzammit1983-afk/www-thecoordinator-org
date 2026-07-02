## Goal

Auto-clean passenger data on both new and existing trips: extract phone numbers from pax names into the trip phone field, and normalize flight codes even after the trip is created.

## Changes

### 1. Shared helpers (`src/lib/parse-trips.ts`)
- Add `extractPhoneFromName(name)` → returns `{ cleanName, phone }`. Regex captures international/local numbers (7+ digits, optional `+`, spaces, dashes, parentheses) embedded anywhere in the pax name string; strips them out and trims residual separators.
- Re-export `extractFlightCode` (already exists in `JobFormDialog`) or move it here so it can be reused server-side and in bulk paste.

### 2. Bulk paste + creation path
- In `parseWhatsAppBlock` (bulk paste): when building pax list, run `extractPhoneFromName` on each name. If a phone is found and the trip has no phone yet, set it on the job; keep the cleaned name in pax.
- In `JobFormDialog` PaxEditor: on add/blur of a pax name, run the same extractor. If phone found, remove digits from the name and, when the trip's phone field is empty, populate it (toast hint like the flight one).

### 3. Fix already-created trips
- New server function `normalizeJobData(jobId)` in `src/lib/coordinator.functions.ts` (chain-access check via existing `assertJobInCompany`):
  - Load job + pax.
  - For each pax: run `extractPhoneFromName`; update `pax.name` if changed; collect first found phone.
  - If job `phone_number` empty and phones found → set it.
  - Normalize `from_flight` / `to_flight` via `extractFlightCode` (uppercase, no spaces); if a code is embedded in `from_location`/`to_location`, move it to the flight field and default location to "Airport" when it becomes empty.
  - Return updated job/pax.
- Trigger points:
  - `TripDetailsSheet`: run once automatically on open (idempotent) and expose a manual "Clean data" button.
  - `JobFormDialog` when editing existing trip: run on open so the form shows corrected values.
  - Optional: call inside `updateJob` after save so edits are always normalized.

### 4. UI feedback
- Small toast: "Moved phone to contact field" / "Normalized flight KM643" when auto-fix changes something. Silent when nothing changes.

## Out of scope
- No schema changes (uses existing `jobs.phone_number`, `jobs.from_flight`, `jobs.to_flight`, `pax.name`).
- No bulk migration over all historical rows; normalization runs lazily when a trip is opened/edited.

## Technical notes
- Phone regex: `/(\+?\d[\d\s\-().]{6,}\d)/` then strip non-digits, keep leading `+` if present; require ≥7 digits to avoid matching room numbers.
- Guard against false positives: if the "name" becomes empty after stripping, keep the original pax entry unchanged.
- All server writes go through `supabaseAdmin` with the existing chain-access assertion, matching current patterns.