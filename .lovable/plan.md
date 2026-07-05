
## Goal

When admin flips a feature switch in **Admin → Features**, the corresponding UI in the coordinator app disappears within seconds. Flipping it back on restores it. Applies to every entry in `FEATURE_CATALOG` — sidebar links, in-page buttons, AI actions, client-portal widgets, branding bar.

The plumbing (`useFeatures` with realtime + 30s poll, `getMyFeatures`, `company_feature_entitlements`) already works — the gap is that most features aren't actually wired into the UI, so toggling them does nothing.

## Approach

**Hide-completely pattern**, uniformly:

1. **Sidebar nav** — tag every route entry with its `feature` key (Branding → `branding_advert`, AI Center → gate on any AI feature being on, Billing/Refer stay always-on). Items with `features[key] === false` are filtered out (already implemented, extend it).
2. **Route guards** — for each feature-gated route, if the feature is off, redirect to `/coordinator`. Prevents deep-link access after toggle-off.
3. **In-page controls** — wrap every feature-specific button/section in a small `<IfFeature feature="…">` helper (returns `null` when off). Applies to:
   - Calendar: `bulk_paste` (paste button), `chat` (chat buttons on cards), `flight_tracking` (flight badge), `live_tracking` (driver map), `labels` (label chips/picker), all AI buttons (`ai_extraction`, `ai_auto_coordinate`, `ai_daily_plan`, `ai_reply_drafter`, `ai_voice_to_trip`)
   - Trip details sheet: same set
   - Client portal (`/c/$token`, `/m/client/$token`): `client_push_notifications`, `client_eta`, `client_sos`, `client_offline_mode`, `client_trip_portal` (whole route)
   - Driver portal + client portal: `branding_advert` gate on `BrandingBar`
4. **Public routes (client portal)** — client portal pages resolve the owning company server-side; extend `coordinator-public.functions.ts` to return the company's feature map so `/c/$token`, `/m/client/$token`, `/m.driver.$token` can hide gated widgets.
5. **Keep refresh cadence** — no change to `useFeatures` (realtime + 30s poll stays).

## Files touched

**New**
- `src/components/billing/IfFeature.tsx` — tiny wrapper: `useFeature(key) ? children : null`. Used across UI.
- `src/hooks/use-public-features.ts` — thin hook wrapping a new `getFeaturesForToken` server fn for public client/driver portal pages.

**Backend**
- `src/lib/coordinator-public.functions.ts` — add `getFeaturesForToken({ token })` that returns the owning company's feature map (reuses same expiry logic as `getMyFeatures`).

**Coordinator UI**
- `src/routes/_authenticated/coordinator.tsx` — extend NAV with feature tags for Branding (`branding_advert`) and AI Center (show when any AI feature enabled). Add early-return redirect if user navigates to a route whose feature is off.
- `src/routes/_authenticated/coordinator.calendar.tsx` — wrap Bulk-paste, Voice-to-trip, AI extraction, AI daily plan, AI reply drafter, chat launcher, flight badge, live map, label chips in `<IfFeature>`.
- `src/routes/_authenticated/coordinator.branding.tsx`, `coordinator.ai-center.tsx`, `coordinator.billing.tsx`, feature-gated pages (`pending`, `drivers`, `portal-links`, `labels`, `statements`, `collaborate`, `my-driving`) — add a `beforeLoad`/component guard that redirects to `/coordinator` when their feature is off.
- `src/components/coordinator/TripDetailsSheet.tsx` — wrap chat, live map, flight badge, AI buttons.
- `src/components/coordinator/JobFormDialog.tsx`, `VoiceToTripButton.tsx` — already use `useFeature`; verify consistent hide-not-lock behavior.
- `src/components/branding/BrandingBar.tsx` — hide when `branding_advert` off (coordinator context uses `useFeature`; portal contexts use new public hook).

**Client / driver portal**
- `src/routes/c.$token.tsx`, `src/routes/m/client/$token.tsx`, `src/routes/t.$token.tsx`, `src/routes/m.driver.$token.tsx` — fetch feature map via `getFeaturesForToken`; gate SOS, ETA, push, offline banners, live map, branding bar. If `client_trip_portal` is off entirely, show a "This trip portal is currently unavailable" fallback.

## Technical notes

- **`useFeature` default while loading**: currently returns `true`. Keep it — avoids a flash of "everything hidden" on first paint. When data arrives, false values re-render and hide.
- **Route redirect**: use `useEffect` + `useNavigate` (features load client-side; `beforeLoad` can't reach the realtime cache). Render `null` while redirecting.
- **AI Center visibility**: derive from `AI_FEATURE_KEYS.some(k => features[k] !== false)` so if admin disables *all* AI, the nav entry disappears too.
- **Public portal**: `getFeaturesForToken` reuses `supabaseAdmin` (already used in `coordinator-public.functions.ts`), joins magic-link/booking token → company_id → entitlements. No auth needed; token is the credential.
- **No schema changes.** No changes to admin `FeatureEntitlementsDialog` or metering.

## Out of scope

- Locked-with-upsell UI (user chose "hide completely").
- Sub-feature entitlements per driver/client.
- Changing realtime cadence.
