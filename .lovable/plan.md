## What we're building

Four related upgrades to how trips are shown and priced:

1. **Show the business/hotel name** instead of plus-codes / `VH79+7PC` on trip cards, in the client portal, and in emails. Actual coordinates + full address stay stored for routing but are hidden from display.
2. **From→To ETA** shown live in the trip form, on the calendar card, and in the client portal ("≈ 30 min").
3. **Two new point-billed features** the admin can toggle per company: `address_name_resolve` and `route_eta`. Priced in Admin → Pricing, gated in Admin → Feature Entitlements, just like existing AI features.
4. **Urgency glow** on unassigned / unaccepted trip cards as pickup time approaches, with admin-configurable thresholds.

---

## 1. Business-name resolution

**Storage** — add to `jobs`:
- `pickup_display_name text` / `dropoff_display_name text`
- `pickup_place_id text` / `dropoff_place_id text` (already partially captured via `AddressPick`, persist it)
- `route_duration_sec int` / `route_distance_m int` / `route_computed_at timestamptz`

**Display rule** (single helper `displayLocation(job, "pickup" | "dropoff")`):
1. Use `*_display_name` if present.
2. Else if the address looks like a Plus Code (`^[23456789CFGHJMPQRVWX]{4}\+[…]`) or bare lat/lng, show a friendly fallback (e.g. "Location pin") until background-fill runs.
3. Else show the address text.

Coordinates and the raw address are never rendered in card / portal — only used internally.

**Background fill** — new server fn `resolveMissingPlaceNames(jobId)`:
- Called on demand (opening trip details, calendar loader batch, or client portal fetch).
- If a pickup/dropoff row is missing `*_display_name` AND has a `place_id` (or is a plus-code that reverse-geocodes cleanly), call Places details, store `displayName.text`, deduct points via `charge_feature('address_name_resolve')`.
- If the company doesn't have the feature entitled OR is out of points → skip silently, keep raw text.

**On new trips** — `JobFormDialog` and bulk paste already thread the `AddressPick` through; extend both call paths to persist `pickup_place_id`, `pickup_display_name` (`s.main` from the autocomplete pick) so no billed lookup is needed for freshly-picked addresses.

---

## 2. From→To ETA

**In the form** (`JobFormDialog`):
- When pickup+dropoff both have coordinates (either from the picker or resolved), debounce 400 ms and call a new server fn `estimateRouteEta({ from, to })` that hits the Routes API through the existing Google Maps gateway.
- Show a small badge under the addresses: *"≈ 28 min · 22 km"*. Loading spinner while pending. Error → hide silently.
- Charge one point via `route_eta` feature per successful call. Cache the result on the trip on save (see columns above) so re-opens don't recharge.

**On the calendar card**:
- Read `route_duration_sec` from the job; render a tiny chip `≈ 28 min` next to the flight badge.
- No auto-fetch from the card itself — the value is only what was already computed at create/edit time (avoids surprise billing during scrolling).
- Show nothing if the field is null.

**In the client portal** (`/t/$token` and `/c/$token`):
- Same chip.
- If missing and the feature is entitled + funded, fill once on portal load and cache.

**Recompute triggers**: whenever pickup or dropoff address changes on edit, `route_duration_sec` is cleared and re-estimated.

---

## 3. Two new billable features

**Additions to `src/lib/features.ts`** — extend `FEATURE_CATALOG`:

```
{ key: "address_name_resolve", label: "Address name lookup",
  description: "Show hotel/business names instead of plus-codes on cards and portals" }
{ key: "route_eta", label: "From→To ETA",
  description: "Estimate trip duration & distance and show it on the form, card, and client portal" }
```

Both flow through the existing `ai_feature_costs` (points per call) and `company_feature_entitlements` (on/off per company) tables — same pattern the AI features already use, so:
- Admin → Pricing gets two new rows to price.
- Admin → Feature Entitlements dialog gets two new toggles per company.
- Coordinator side: gate the calls with the existing `IfFeature` / `useFeatures` hook, using `charge_feature` on the server side; on insufficient points, fail closed (skip lookup, keep raw address / no ETA badge) and log to `ai_command_log`.

Address autocomplete stays free (already gated behind the `AddressAutocomplete` component's `useAddressSettings`) — only the *name resolve* and *ETA* API calls are billed.

---

## 4. Urgency glow on unassigned / unaccepted cards

**Admin-configurable thresholds** — extend `admin_portal_settings` (or add company-level override to `companies`):
- `urgency_green_min int default 60`
- `urgency_orange_min int default 45`
- `urgency_red_min int default 30`

Editable in Admin → Portal Settings (existing page).

**Card behaviour** (calendar):
- Compute `minutesToPickup = (pickupIso - now) / 60000`.
- Applies only when `driver_id is null` OR `status in ('offered','pending_accept')`.
- Class map:
  - `minutes ≤ red` → `ring-2 ring-red-500 shadow-[0_0_12px_rgba(239,68,68,0.55)] animate-pulse`
  - `minutes ≤ orange` → `ring-2 ring-orange-500 shadow-[0_0_10px_rgba(249,115,22,0.5)]`
  - `minutes ≤ green` → `ring-2 ring-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.45)]`
  - else → no glow
- A single `setInterval(60_000)` tick already exists on the calendar — reuse it so all cards re-evaluate every minute.
- Stops glowing once the trip is accepted / assigned / cancelled.

---

## Files touched

- **Migration**: new columns on `jobs`, 3 threshold columns on `admin_portal_settings`, 2 new rows in `ai_feature_costs`.
- **`src/lib/features.ts`** — add the two feature keys.
- **`src/lib/places.functions.ts`** — new `resolveMissingPlaceNames` + `estimateRouteEta` server fns, both billed via `charge_feature`.
- **`src/lib/booking.functions.ts`** — persist `*_place_id`, `*_display_name`, clear route cache on address change.
- **`src/lib/coordinator-public.functions.ts`** / **portal loaders** — return the new fields.
- **`src/components/coordinator/JobFormDialog.tsx`** — live ETA badge, persist names.
- **`src/routes/_authenticated/coordinator.calendar.tsx`** — swap address display for `displayLocation()`, add ETA chip, urgency glow.
- **`src/components/coordinator/TripDetailsSheet.tsx`** — same display swap + ETA chip.
- **`src/routes/t.$token.tsx`** / **`src/routes/c.$token.tsx`** — same display swap + ETA chip in client portal.
- **`src/routes/_authenticated/admin.pricing.tsx`** — auto-picks up the 2 new feature keys (no code change beyond migration seed).
- **`src/components/admin/FeatureEntitlementsDialog.tsx`** — auto via `FEATURE_CATALOG`.
- **`src/routes/_authenticated/admin.portal-settings.tsx`** — three number inputs for the glow thresholds.

## Out of scope

- No changes to how the driver app renders addresses (drivers still need the full address for navigation).
- No changes to the bulk-paste parser other than persisting `place_id`/`display_name` when the user has already accepted picks.
- No new UI for editing / overriding a resolved name manually — can add later if needed.
