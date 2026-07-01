# Trip Progress Status + Detailed Card View

## 1. Extend driver status flow

Add two intermediate stages to the driver progression in `src/routes/m.driver.$token.tsx`:

```ts
const STATUS_FLOW = [
  { value: "en_route",    label: "On the way to pickup" },
  { value: "arrived",     label: "Arrived at pickup" },
  { value: "in_progress", label: "Passengers on board — en route" }, // renamed
  { value: "completed",   label: "Trip finished" },
];
```

No DB enum change needed — reuses existing `job_status` values (`en_route`, `arrived`, `in_progress`, `completed`). Only labels + UI copy change on the driver portal.

## 2. Progress indicator on coordinator trip cards

In `src/routes/_authenticated/coordinator.calendar.tsx` (`TripCard`), add a compact progress row above the badges showing the current stage of the trip:

```text
● On the way   ○ Arrived   ○ On board   ○ Finished
```

- 4 dots + labels, current stage highlighted (primary color), completed stages filled emerald, upcoming muted.
- Derived from `job.status`.
- Also show a small "All aboard ✓" badge when every pax has `status === 'onboard'` (or when `pax_count > 0` and boarded count equals pax_count). Requires `listJobs` to return an onboard-count per job (or reuse existing `pax` array if present).
- Red pulse dot when `job.status === 'in_progress'` and there's a flight/deletion problem — reusing existing `problem` flag.

## 3. Tap card → detailed info modal

Currently tapping the card opens the edit dialog. Change to open a **read-only details sheet** first, with an "Edit" button inside for coordinators (partner-owned trips get no Edit button, matching current disabled behavior).

New component: `src/components/coordinator/TripDetailsSheet.tsx` (shadcn `Sheet`, right side on desktop / bottom on mobile). Shows:

- Header: from → to, pickup date/time, status progress bar (same 4-step component as card).
- Client company, contact, notes.
- Driver: name, phone, accepted status, seats available, availability note.
- Passengers list with per-pax status (pending / verified / onboard) + counts.
- Flight block: code, scheduled, estimated, status message.
- Labels, QR/tracking toggles, payment status.
- Chain timeline (reuse existing `ChainTimeline`).
- Footer buttons: **Edit trip**, **Chat**, **Share to driver**, **Copy link**.

Card `onClick` handler swaps from `ctx.onEdit(job)` to `ctx.onOpenDetails(job)`. The edit dialog is still reachable from the sheet's Edit button and from the existing dropdown menu.

## 4. "Found everyone" signal

- Driver portal (`m.driver.$token.tsx`): after the pax list, show a green **"All passengers found ✓"** banner + auto-suggest advancing to `in_progress` when boarded count === pax count.
- Coordinator card + details sheet: show boarded ratio (`3/3 onboard`) badge; turns green when full.
- Uses existing pax `status === 'onboard'` field — no schema changes.

## 5. Files touched

- `src/routes/m.driver.$token.tsx` — updated STATUS_FLOW labels, "all found" banner.
- `src/routes/_authenticated/coordinator.calendar.tsx` — progress row on TripCard, swap tap handler to open details sheet, boarded badge.
- `src/components/coordinator/TripProgress.tsx` — new shared 4-step progress component.
- `src/components/coordinator/TripDetailsSheet.tsx` — new read-only details sheet.
- `src/lib/coordinator.functions.ts` — extend `listJobs` job shape to include `onboard_count` (cheap `pax` aggregation) if not already present.

## Non-goals

- No DB migration (statuses already exist).
- No changes to dispatch/chain logic.
- No changes to client portal.
