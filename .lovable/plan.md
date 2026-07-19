## User Settings & Home Screen Customization

A new **/settings** page (per-user) where anyone — coordinator, driver, or client — can turn AI/automation features on or off to save points, and redesign their mobile home screen.

### 1. Database

New table `user_preferences` (per-user, RLS `auth.uid() = user_id`):

- `ai_toggles jsonb` — one boolean per feature, default `{}` (missing = on). Keys:
  - Background AI: `auto_flight_tracking`, `flight_t30_cron`, `ai_watchtower`, `schedule_collision`, `ai_learning_capture`
  - On-demand AI: `assistant_fab`, `assistant_voice`, `ai_bulk_paste`, `ai_auto_pricing`, `ai_address_enrichment`, `ai_lesson_suggestions`
  - Routing: `live_eta_polling`, `route_deviation_alerts`, `traffic_badges`
- `home_layout jsonb` — `{ default_tab: 'dashboard', tabs: [...ordered ids], hidden_tabs: [...], quick_actions: [...ordered tile ids] }`
- `theme` (light/dark/system), `haptics_enabled`, `sound_enabled`

Helper `usePreferences()` hook + `getUserPrefs()` server fn with a 60s in-memory cache keyed by user id. All call sites read via one gate: `if (!prefs.ai(feature)) return early`.

### 2. Toggle enforcement (fine-grained, no functionality removed by default)

Wire the gate into each existing site so a disabled toggle short-circuits *before* any AI/API spend:

| Toggle | Gated in |
|---|---|
| auto_flight_tracking / flight_t30_cron | `fetchLiveStatusViaGemini`, T-30 cron loop (skips user's own trips) |
| ai_watchtower | watchtower scan filter |
| schedule_collision | `ScheduleConflictBanner` render + collision check |
| assistant_fab / voice | Floating assistant mount + mic button |
| ai_bulk_paste | `JobFormDialog` falls back to legacy regex parser |
| ai_auto_pricing | `auto-price.server` returns null → manual entry |
| ai_address_enrichment | `AddressAutocomplete` skips Places call, plain input |
| live_eta_polling | Dashboard 60s poller pauses |
| route_deviation_alerts | `useLiveRoute` disables reroute |

Each toggle row shows an estimated points/day badge derived from that user's last-30-day `ai_cost_events` for the matching feature key.

### 3. Home screen customizer (mobile)

Full custom home screen editor:

- **Tab bar builder** — drag-reorder the 4 bottom tabs, hide any, choose which becomes the default landing tab on app open. Live preview beside the list.
- **Quick actions grid** — the dashboard tile grid ("New Trip", "Chat with AI", "Today's Trips", "Wallet", "Drivers", "Groups", "Help", "Route Preview", etc.) becomes a drag grid: reorder, hide, resize (1×1 / 2×1), pin favorites to the top.
- **Presets** as a shortcut: *Driver-first*, *Dispatcher-first*, *Client-first*, *Minimal* — one tap fills the layout, user can then tweak.
- **Reset to default** button.

Mobile shell (`src/routes/m.*` + bottom tab component) reads `home_layout` and renders accordingly. Desktop coordinator dashboard also honors the `quick_actions` order.

### 4. Page structure & look

Route `/settings` under `_authenticated/`, mobile-first, using an **iOS-style grouped list** (matches the existing `m.*` mobile shell) with these sections:

1. **Home screen** — opens the layout customizer (full-screen editor sheet)
2. **AI & automation** — grouped: *Background*, *On-demand*, *Routing*; each row = icon + name + short description + points/day chip + switch. Master switch at top ("Disable all AI").
3. **Notifications** — push, sound, haptics (reuse `notification_preferences`).
4. **Appearance** — theme, density.
5. **Account** — links to profile/security (existing pages).

Sticky "Reset section" per group. Desktop shows the same sections as a two-column list.

### 5. Discoverability

- Header avatar menu → "Settings" link.
- After a user hits an AI overage/paywall, toast: "Save points → adjust in Settings".
- Onboarding chip on first login pointing to Home-screen customizer.

### Technical notes

- Migration adds `public.user_preferences` with GRANTs to `authenticated` + `service_role`, RLS scoped to `auth.uid()`.
- `getUserPrefs`/`updateUserPrefs` server fns via `requireSupabaseAuth`; realtime not needed — invalidate the client cache on save.
- `home_layout` schema validated with Zod; unknown tile ids ignored so future tiles don't break saved layouts.
- All cron/background jobs already run per-company; add a per-user opt-out lookup at the top of each loop.
- No changes to admin pricing, entitlements (hard gating still wins if admin disables a feature company-wide — user toggles only work within what's enabled).
