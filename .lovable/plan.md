# Driver screen mobile polish

Focused UI-only pass on `src/routes/m.driver.$token.tsx`. No server-fn changes, no data-model changes, no changes to what the buttons *do* — only how they look and where they sit.

## 1. Single sticky primary action

Today the driver card has multiple full-width buttons stacked (Accept, On the way, Arrived, Onboard, Completed…), each competing for attention. Replace with:

- One **sticky bottom action bar** anchored to the viewport (`fixed bottom-0 inset-x-0`, `env(safe-area-inset-bottom)` padding, `bg-background/95 backdrop-blur border-t`).
- Bar shows exactly **one** primary CTA — the next logical status step, chosen from current `job.status`:
  - `pending` → **Accept trip**
  - `accepted` → **On the way**
  - `en_route` → **Arrived at pickup**
  - `arrived` → **Passenger onboard**
  - `in_progress` → **Complete trip**
  - `completed` → hide the bar
- CTA is `h-14`, full-width minus 16px gutters, `text-base font-semibold`, high-contrast primary token.
- Secondary actions (Navigate, Call, Chat, Report late, Emergency) move to a small **kebab menu / bottom sheet** to the left of the primary CTA (56×56 tap target).
- The primary CTA still fires the same `statusMut` + `fireDriverActionLog` flow — no logic changes.

## 2. Larger tap targets

Audit every button on the driver card:

- Primary CTA: `min-h-14` (56px).
- Icon buttons (Navigate, Call, Chat, Kebab): `min-h-12 min-w-12` (48px), `rounded-full`.
- Per-pax Onboard / No-show chips: `min-h-11` (44px), full-tap surface (whole row is tappable, not just the icon).
- Status/labels chips: `min-h-8`, `px-3`.
- Increase spacing between adjacent taps to 8px minimum (`gap-2`) so fat-finger misses drop.

## 3. Clearer status pill

Replace the current small text-only status with a **status pill** at the top of each trip card:

- Anatomy: colored dot · label · relative time (`Arrived · 2 min ago`).
- Color per status using semantic tokens (add to `src/styles.css` if not present):
  - `pending` → muted slate
  - `accepted` → sky
  - `en_route` → amber, animated pulse dot
  - `arrived` → emerald, pulse dot
  - `in_progress` → blue, pulse dot
  - `completed` → violet, static
  - `cancelled` / rejected → rose
- Pill sits in the card header, `h-9`, `text-sm font-medium`, `rounded-full`, contrasting bg tint (`bg-<color>-500/10 text-<color>-700 dark:text-<color>-300`).
- A second smaller pill next to it surfaces high-value context when relevant: `⏱ waiting 04:12`, `⚠ late reported +15 min`, `🛑 override active`.

## 4. Cleanup that follows

- Remove the now-redundant inline status action buttons from inside the card body.
- Keep Accept / Reject as a **two-button** sticky bar only in the `pending` state (Reject = ghost, Accept = primary). Every other state has exactly one primary CTA.
- Ensure the sticky bar reserves space at the bottom of the scroll container (`pb-24`) so the last card isn't hidden under it.
- Respect the existing `formatDriverStatusError` toast flow — unchanged.

## Files touched

- `src/routes/m.driver.$token.tsx` — reorganize the trip card (status pill at top, remove inline action grid) and add the sticky bottom action bar with kebab.
- `src/styles.css` — add status pill color tokens if missing.
- (Possibly) a small new component `src/components/driver/DriverActionBar.tsx` to keep the sticky bar isolated and testable — plain UI, no new hooks.

## Out of scope

- No changes to server functions, mutations, or trip-map logging.
- No changes to the grouped-trip / multi-stop layouts (those are governed by the pending grouped-trips plan).
- No design-token overhaul beyond the status pill colors.
- No new dependencies.
