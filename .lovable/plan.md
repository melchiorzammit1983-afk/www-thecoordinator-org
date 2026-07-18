
# Dispatch page redesign — split list + detail, tiered card density

Goal: kill the "everything on top of each other" feel. Slim top bar, one prioritized list on the left, focused detail panel on the right. Cards stay minimal by default; **Active & Waiting** trips get a richer inline card so the coordinator can see what's happening without opening the panel.

## Layout

Desktop (≥ md):
```text
┌──────────────────────────────────────────────────────────────┐
│  Sat 18 Jul  ‹ › Today   [Day|Week]        🔍  ⚙ Filters  + │
├───────────────────────────┬──────────────────────────────────┤
│ Needs action • Live •     │                                  │
│   Scheduled • Done        │      TRIP DETAIL PANEL           │
│                           │   (map, route, driver, timeline, │
│  ▸ Unassigned (2)   [!]   │    contact, chat, actions)       │
│  ▸ Live now (1)  ← rich   │                                  │
│  ▸ Later today (3)        │                                  │
│  ▸ Done (hidden)          │                                  │
└───────────────────────────┴──────────────────────────────────┘
```

Mobile (< md):
- Same segmented tabs. Full-width list. Tap card → full-screen detail sheet.
- Sticky bottom bar: **+ New trip · Ask AI · Auto‑coordinate**.
- Filter/sort behind one **Filters** button → bottom sheet.

## Top bar (replaces the current toolbar wall)

Only: Date + Prev/Next/Today, Day/Week toggle, Search, one **Filters** button. The Filters popover holds Status, Driver chips (light/moderate/heavy/severe), Sort, Only alerts, Hide completed, Auto‑refresh.

## Left list

- Segmented control: **Needs action · Live · Scheduled · Done** (Done off by default; "Needs action" = unassigned + conflict + tight ETA).
- Collapsible sections: Unassigned, Live now, Later today, Done.
- Ask AI + Auto‑coordinate sit in a compact toolbar above the list.

## Card density — two tiers

### Minimal card (Scheduled / Later / Done)
- Trip # + time (large)
- Route: From → To (single line, truncates)
- Status pill
- Driver avatar + name (or "Unassigned")
- Conflict/ETA/traffic chip if present
- Tap → detail panel. "⋯" for quick actions.

**No route thumbnail on the card.** No flight code, notes, or map. Route thumb only appears in the detail panel.

### Rich card (Active & Waiting: `accepted` / `on_the_way` / `arrived` / `waiting` / `in_progress`)
Adds under the minimal header, inline:
- **Live status strip**: current status + time since last update ("arrived · 3m ago")
- **Live ETA / distance to next point** with traffic badge and freshness tooltip
- **Leave-by** countdown (if not yet started)
- **Wait timer** (if arrived/waiting) anchored to `max(now, pickup_at)`
- **Progress bar**: pickup → dropoff, dot at current position
- **Alert row** if flight delay / conflict / off-route
- Inline quick actions: **Message driver**, **Open**, **Ask AI**

Still **no route thumbnail** — the live map lives in the detail panel. Passenger contact, flight/vessel details, timeline, notes also stay in the panel.

## Detail panel (right side / full-screen sheet on mobile)

Single scroll: header (trip #, time, status, driver, primary action) → route map + ETA → passenger/contact/flight → timeline of map events → notes → footer actions (Ask AI, Group, Split, Duplicate, History). Reuses `TripDetailsSheet`, `TripEventsMap`, `TripRouteInsights`, `TripChatDialog`.

## Behavior

- Selecting a card highlights it and swaps the right panel.
- Deep link `?trip=<id>` preserves selection on refresh.
- Rich cards live-update on the same 60s ETA poll + Realtime status events already in place.
- Auto-refresh unchanged.

## Files to touch

- `src/routes/_authenticated/coordinator.calendar.tsx` — new split layout, segmented tabs, grouped sections, URL-synced selection. Remove `RouteThumb` usage from list cards.
- `src/routes/_authenticated/coordinator.tsx` — drop the competing top toolbar chrome.
- New `src/components/coordinator/DispatchFiltersSheet.tsx` — consolidated filter/sort.
- New `src/components/coordinator/TripDetailPanel.tsx` — right panel; wraps in `ResponsiveDialog` on mobile. Route map lives here (existing `TripEventsMap` / `TripRouteInsights`).
- New `TripCardMinimal.tsx` and `TripCardActive.tsx` (or one `TripCard` with a `variant` prop) for the two tiers. Reuse `TrafficBadge`, `TripConflictBadge`, `TripProgress`, wait-time helpers, `describeEtaFreshness`. **No `RouteThumb` in either card.**

## Out of scope

- No changes to scheduling, conflict math, AI assistant, or data model.
- Kanban and Timeline-by-driver views not built now — can be added as extra tabs later.
