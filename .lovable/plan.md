
## Problem

On mobile the top of every trip card is a collision zone:

- top-left: multi-select checkbox
- top-right (stacked at nearly the same coords): "Ask AI" ghost button (`top-1 right-1`), drag handle, and the `TripMenu` kebab (`top-1.5 right-1`)

"Ask AI" is `size="xs" variant="ghost"`, well under a 44 px tap target, and sits directly on top of the kebab. One tap usually hits the wrong control. There is no room for other actions (assign, message, WhatsApp, copy link, timeline) so everything is buried in the kebab menu.

Scope: visual/layout only, in `src/routes/_authenticated/coordinator.calendar.tsx` (the `TripCard` component around lines 2557–2943). No changes to data, mutations, or server functions.

## Plan

1. **Clean the top-right corner.**
   - Remove the standalone "Ask AI" button at `top-1 right-1`.
   - Keep only the drag handle (desktop) + `TripMenu` kebab there, and bump the kebab to `min-h-11 min-w-11` so it's an easy tap.
   - Widen the card's right padding from `pr-1` back to `pr-2` so the kebab doesn't kiss the edge.

2. **Add a dedicated action bar inside the expanded state.**
   Right after the existing expanded "extra details" block (around line 2889), render a horizontal row of large, evenly spaced buttons. Each button is `size="sm"` (≥ 36 px) with `min-h-11` on touch, `flex-1` so they share the row width, icon + short label:
   - **Ask AI** — opens `AskAiInlineButton` behavior with the trip pre-filled.
   - **Message** — opens the existing trip chat (reuses the same handler the kebab uses).
   - **Share** — WhatsApp share (reuses `shareMut` behavior; exposed via a small callback from `TripMenu` or by lifting the mutation into the card).
   - **Copy link** — reuses `copyMut`.
   - **More** — opens the existing `TripMenu` for the long tail (split, clone, dispatch, delete, ungroup, recall).

   The bar wraps to two rows on very narrow widths (`flex-wrap`) so nothing gets clipped.

3. **Make "More" the default entry point on mobile.**
   - Add a small always-visible "Actions" chevron pill under the pax/badges row that toggles `expanded` (in addition to the existing "More/Less" text link). This gives users a bigger tap surface to reveal the action bar without hitting the tiny chevron.
   - `expanded` state already exists; no new state needed.

4. **Accessibility & spacing.**
   - Every icon-only button gets an `aria-label`.
   - Buttons in the action bar use `min-h-11` and `gap-2` so touch targets meet the 44 px guideline referenced in the a11y rules.
   - Keep semantic tokens (`bg-background`, `text-foreground`, `border-border`); no hardcoded colors.

5. **Verify.**
   - Typecheck the file.
   - Open the coordinator calendar on the 375 px viewport, expand a card, screenshot, and confirm the action bar is reachable with a thumb and the kebab no longer overlaps Ask AI.

## Out of scope

- No backend, RLS, or server-function changes.
- No changes to the completed-trip `CompletedStrip` variant.
- No redesign of the `TripDetailsSheet`; the action bar is a shortcut to actions that already exist in the kebab or sheet.
