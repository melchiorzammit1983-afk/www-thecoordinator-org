# AI Trip Extraction (Lovable AI) + Admin Feature Gate

## Backend

**New server function** `extractTripsFromText` in `src/lib/coordinator.functions.ts`:
- Auth: `requireSupabaseAuth`
- Input: `{ text: string }`
- **Feature gate**: calls `has_feature(company_id, 'ai_extraction')` — throws `feature_disabled` if the admin has blocked it for the coordinator's company
- Calls Lovable AI Gateway via AI SDK using `google/gemini-3-flash-preview` (uses `LOVABLE_API_KEY`, already set)
- Uses `generateText` + `Output.object` with a flat Zod schema:
  - `trips[]`: `{ from_location, to_location, pickup_date, pickup_time, flight_code?, contact_phone?, notes?, passengers: string[] }`
- Multilingual system prompt (Italian, English, etc.); normalizes flight codes uppercase; today's date passed in for relative terms ("domani", "tomorrow")
- Catches `NoObjectGeneratedError`; surfaces 429/402 gateway errors clearly

## Admin control

- Register `ai_extraction` as a known feature key in `FeatureEntitlementsDialog.tsx` (existing admin dialog that writes to `company_feature_entitlements`)
- Default: enabled (matches `has_feature` behavior — returns `true` when no entitlement row exists)
- Admin can disable per-company; disabled companies get a clear error toast on the button

## Frontend

**`JobFormDialog.tsx` — Bulk paste tab:**
- Add "✨ Understand with AI" button next to existing "Parse" button
- Client-side check via new lightweight `getMyFeatures` server fn (or reuse existing entitlements query) to hide/disable the button when the feature is blocked
- On click: call `extractTripsFromText`, merge results into the existing review list
- Loading spinner; success/error toast

## Files touched
- `src/lib/coordinator.functions.ts` — `extractTripsFromText` + `getMyFeatures`
- `src/components/coordinator/JobFormDialog.tsx` — AI button + gating
- `src/components/admin/FeatureEntitlementsDialog.tsx` — add `ai_extraction` to feature list

## Cost note
Uses Lovable AI credits (Gemini Flash ~fractions of a cent per call). Admin can disable per-company to control spend.
