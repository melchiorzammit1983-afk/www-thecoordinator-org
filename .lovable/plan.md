## Goal

1. Any dialog/sheet in the app fits a phone screen (390px) without clipping or horizontal scroll.
2. Every address input in the app uses Google Places autocomplete, Malta-biased but worldwide allowed, and stores the cleaned address + `place_id` + `lat/lng`.
3. Bulk paste auto-accepts Google's best match for unmatched From/To and flags the row so the user can undo.
4. A new "Address & Map settings" page lets the user tune the behaviour.

Google Maps Platform is already connected (gateway-enabled), so no key setup is needed.

---

## 1. Shared address autocomplete component

New `src/components/address/AddressAutocomplete.tsx`:
- Debounced input (250ms) that calls a new server function `placesAutocomplete` (uses Google Places API New `places:autocomplete` through the connector gateway).
- Session token per input instance to keep Google billing on the cheap "session" tier.
- Malta bias via `locationBias.circle` around Malta center (radius ~50km), no hard restriction so airports/cruise ports abroad still appear.
- Dropdown with keyboard nav (Radix Popover + Command list, matching existing shadcn look).
- On select: calls `placesDetails` server fn to get `formattedAddress`, `location.latitude/longitude`, `id` — returns `{ address, place_id, lat, lng }` to the parent.
- Free-text fallback: user can still type a custom string and blur to accept it (flagged as `place_id: null`).
- Props: `value`, `onChange({address, place_id, lat, lng})`, `placeholder`, `disabled`, plus settings overrides (bias center/radius) read from a small `useAddressSettings()` hook.

New server functions in `src/lib/places.functions.ts` (calls gateway, no key in browser):
- `placesAutocomplete({ input, session_token, bias })`
- `placesDetails({ place_id, session_token })`

Both validate input with zod, surface provider errors verbatim, and are rate-safe (small server-side in-memory throttle keyed by IP).

## 2. Replace every address input

Swap raw `<Input>` for `<AddressAutocomplete>` in:
- `src/components/client/EditBookingDialog.tsx` — From, To
- Client booking form on `src/routes/c.$token.tsx` and `src/routes/portal.$token.tsx` — From, To
- `src/components/coordinator/JobFormDialog.tsx` — from_location, to_location
- `src/components/coordinator/GroupDialog.tsx` (if it has address fields)
- Portal booking submission via `src/routes/api/public/portal/$token/bookings.ts` — add optional `from_place_id/from_lat/from_lng` (and same for `to_`) to the zod schema.
- Any other component under `src/components/**` and `src/routes/**` with an address-looking `<Input>`; audit with ripgrep on `from_location|to_location|pickup_address|address`.

Rule going forward (added to `AGENTS.md`): "Any new address input MUST use `AddressAutocomplete`, never a raw `<Input>`."

## 3. Mobile fit for dialogs

- Migrate every large dialog to the existing `ResponsiveDialog` primitive (already renders as bottom sheet on mobile). Targets: `EditBookingDialog`, `JobFormDialog`, `GroupDialog`, `MergeTripsDialog`, `PaxSplitDialog`, `TripDetailsSheet`, `RecurringDialog`, `ChangePasswordDialog`, `RequestTopupDialog`, `CompanyBillingDialog`, `FeatureEntitlementsDialog`, `TripChatDialog`, `TripSummaryDialog`.
- Inside each: enforce the mobile-safe grid pattern from knowledge — `grid-cols-1 sm:grid-cols-2`, `min-w-0`, `shrink-0` on icons, `truncate` on headings, sticky footer with save/cancel using `pb-safe`.
- Verify at 390×808 with Playwright screenshots after the change.

## 4. Bulk paste auto-fix

Update `src/lib/sheet-template.ts` and `src/lib/parse-trips.ts`:
- After parsing, for each row with a non-empty From/To, call `placesAutocomplete` server-side in batch (`resolveAddresses({ items: [{row, field, text}] })` — a new server fn that runs Places lookups in parallel, capped at 20 concurrent).
- Auto-replace the text with the top suggestion's `formattedAddress` when confidence looks good (top result exists and its `text.matches` covers the input, or a single-result response).
- Attach `place_id`, `lat`, `lng` to the parsed trip and add a new `autoFixed?: { field: 'from'|'to'; original: string }[]` marker.
- In the bulk preview table (wherever `ParsedTrip` is rendered), badge auto-fixed cells with a small "Auto-fixed" chip and an Undo button that restores the original text and clears `place_id`.

## 5. Address & Map settings page

New route: `src/routes/_authenticated/coordinator.address-settings.tsx`, linked from the coordinator sidebar.
Settings persisted per user in a new `public.user_address_preferences` table (RLS: user reads/writes own row; standard grants per project rules):

- Default bias country (Malta by default) — dropdown.
- Bias radius (km) — slider 5–200.
- Suggestion types filter — checkboxes for `lodging`, `airport`, `establishment`, `geocode`.
- Auto-accept top match on bulk paste — toggle (default on).
- Show inline map preview under selected address — toggle.
- Language + region codes — inputs.

`useAddressSettings()` reads this row via TanStack Query and feeds `AddressAutocomplete` and the bulk resolver.

## 6. Data model

Migration `add_address_geo`:
- `client_bookings`: add `from_place_id text`, `from_lat double precision`, `from_lng double precision`, and matching `to_*` columns. Same for `portal_bookings.payload` (JSONB — no migration, just schema update in code).
- `jobs`: add same 6 columns so the coordinator's accepted trip keeps the geo data flowing through.
- `user_address_preferences` table with GRANT + RLS per project rules.

## 7. Technical details

- Connector: reuse existing gateway pattern — `fetch('https://connector-gateway.lovable.dev/google_maps/places/v1/places:autocomplete', { headers: Authorization + X-Connection-Api-Key, body: {input, sessionToken, locationBias} })`. All Places API calls go server-side to keep quotas predictable; the browser only ever talks to our server fns.
- The dev-only mobile fix uses `useIsMobile()` + `ResponsiveDialog`; no new libraries.
- Zod schemas on every new server fn; input length caps (`input.max(120)`).
- Error surfacing: log status + body, show a toast "Address lookup unavailable — you can still type manually".

## 8. Verification

- Playwright headless at 1280×1800 AND at 390×808 for each edited dialog; screenshot compared.
- Manual smoke: type "Hilton" into From on `/coordinator/calendar` → expect Malta Hiltons first, Rome Hilton lower.
- Bulk paste a row with "hilton" as pickup → expect it auto-fixed to "Hilton Malta, St Julian's" with an Undo chip.
- New settings page loads, toggles persist across reloads.
