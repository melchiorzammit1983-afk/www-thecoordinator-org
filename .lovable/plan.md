## Problem

On `/t/$token`, when a trip has multiple passengers (or is a grouped trip), the "Which passenger are you?" prompt is rendered inline between the header and the tabs. On desktop and taller phones it sits below the fold or blends into the page, so users don't realize they need to pick a name — reported as "the pop-up didn't come up".

Additionally, `needsIdentity` only fires when `data.pax.length > 1`. Grouped trips where each sibling job has a single pax (so the merged list is still >1) do work, but a grouped trip with only 1 pax per sibling and duplicates isn't handled cleanly, and there's no re-open path once dismissed.

## Fix

1. **Turn `IdentityPicker` into an actual modal** using the existing shadcn `Dialog`:
   - Auto-opens on load whenever `needsIdentity` is true.
   - Not dismissable by outside click / Esc (only by choosing a name or the explicit "Skip for now" button), so it behaves like a real prompt.
   - Same choice list as today; on success it closes and invalidates `client-portal`.

2. **Broaden the trigger** so grouped trips always prompt:
   - `needsIdentity = !hasIdentity && uniquePax.length > 1` where `uniquePax` dedupes `data.pax` by trimmed lowercase name (prevents duplicate rows from siblings).
   - Also show when `isGroup` is true and there is >1 unique pax overall.

3. **Add a "Change name" affordance** in the header chip (next to "Signed in as …") and in the Chat tab header, so a user can re-open the picker after skipping or if they picked the wrong name.

4. **Chat guard**: when the user opens the Private chat tab without an identity, show an inline "Choose your name" button that opens the same modal, instead of only surfacing the server error.

## Files touched

- `src/routes/t.$token.tsx` — replace inline `IdentityPicker` block with a controlled `Dialog`, add dedupe, add "Change name" buttons, guard Private chat tab.

No backend or schema changes.
