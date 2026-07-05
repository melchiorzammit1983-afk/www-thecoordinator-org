
## Goal

Rebuild the mobile experience across the whole app — coordinator dashboard and the public client/driver portals — so it feels native on a phone. Everything is thumb-reachable, nothing is cropped, tap targets are big enough, and dialogs behave like real mobile sheets. Desktop is untouched.

## What changes on screen

1. **Bottom tab bar (mobile only, ≥768px hidden)**
   - Fixed at the bottom with safe-area padding for iOS home-indicator.
   - Coordinator: `Dashboard · Dispatch · Drivers · Billing · More`.
   - Portals (client `/c/$token`, `/m/client/$token`, `/t/$token` + driver `/m/driver/$token`): same shell, tabs adapted to the surface (e.g. `Trip · Chat · Map · SOS · More` for client; `Today · Trip · Map · Status · More` for driver).
   - Icons + labels, 56px tall, active state uses `primary` token.

2. **"More" drawer**
   - Slide-up sheet from the 5th tab. Lists everything not pinned (Pending, Portal Links, Labels, Statements, Collaborate, My Driving, Branding, AI Center, Refer & earn, Change password, Sign out).
   - Feature-gated items still hidden when disabled (existing `useFeatures` filter).

3. **Auto-hiding top header (mobile only)**
   - The current `<aside>` header row (logo + company + points badge + password/signout) becomes a translucent top bar.
   - Hides on scroll-down, reveals on scroll-up. Points badge stays tappable.
   - Height reduced from ~64px to 52px, tighter spacing.

4. **Dialogs → bottom sheets on mobile**
   - `JobFormDialog`, `TripDetailsSheet`, `ChangePasswordDialog`, `RequestTopupDialog`, `EditBookingDialog`, `RecurringDialog`, `GroupDialog`, `PaxSplitDialog`, `TripChatDialog`, `TripSummaryDialog`, `FeatureEntitlementsDialog`, `CompanyBillingDialog`.
   - On `<md` screens: render as `<Sheet side="bottom">` with drag handle, rounded top corners, safe-area bottom padding, sticky action footer.
   - On `≥md`: keep current centered `Dialog`.

5. **Content polish (page-by-page)**
   - **Calendar / Dispatch**: cards get more breathing room; horizontal filter bar becomes a chip row that wraps; bulk-paste and AI buttons collapse into a floating action button (FAB) above the tab bar.
   - **Drivers / Pending / Portal Links / Labels / Statements**: tables that currently overflow become stacked cards with primary field first, secondary fields as dim rows, actions in a right-side kebab menu.
   - **Billing**: point balance hero card, plan tile, recent-ledger stacked cards, top-up button as sticky bottom action.
   - **Public portals**: hero info first (pickup/dropoff, time, driver), map takes viewport width, SOS button as prominent floating pill above the tab bar when enabled.

6. **Typography & spacing**
   - Base body bumped from 14px → 15px on mobile.
   - Minimum tap target 44×44px enforced on all interactive elements.
   - Section padding uses `px-4` mobile / `px-6` desktop consistently.
   - Add `min-w-0` + `truncate` to every flex text container so nothing clips.

## Approach

- Introduce `<MobileTabBar />` (coordinator) + `<PortalTabBar />` (public) as thin new components — no route restructuring.
- Introduce `<ResponsiveDialog />` wrapper: renders `<Sheet side="bottom">` when `useIsMobile()` is true, `<Dialog>` otherwise. Retrofit each dialog by swapping its wrapper import.
- Introduce `useScrollDirection()` hook for the auto-hiding header (throttled with `requestAnimationFrame`).
- Extend `coordinator.tsx` layout: on mobile, hide `<aside>` nav strip and top signout row, render `<MobileTabBar />`.
- Extend the four portal route files to share `<PortalTabBar />` and safe-area padding.
- No changes to routes, server functions, database, feature gating logic, or business rules.

## Files touched

**New**
- `src/components/mobile/MobileTabBar.tsx` — coordinator bottom tabs + More drawer.
- `src/components/mobile/PortalTabBar.tsx` — client/driver portal bottom tabs.
- `src/components/mobile/MobileHeader.tsx` — auto-hiding top bar.
- `src/components/mobile/ResponsiveDialog.tsx` — Dialog/Sheet switcher.
- `src/hooks/use-scroll-direction.ts` — scroll-direction detector.

**Edited (layout shells)**
- `src/routes/_authenticated/coordinator.tsx` — swap desktop sidebar for `MobileHeader` + `MobileTabBar` on mobile.
- `src/routes/c.$token.tsx`, `src/routes/m/client/$token.tsx`, `src/routes/t.$token.tsx`, `src/routes/m.driver.$token.tsx` — add `PortalTabBar` and safe-area padding.
- `src/styles.css` — safe-area CSS variables (`env(safe-area-inset-*)`), mobile base font.

**Edited (dialogs → responsive)**
- `src/components/coordinator/JobFormDialog.tsx`, `TripDetailsSheet.tsx`, `ChangePasswordDialog.tsx`, `GroupDialog.tsx`, `PaxSplitDialog.tsx`, `VoiceToTripButton.tsx`.
- `src/components/billing/RequestTopupDialog.tsx`.
- `src/components/client/EditBookingDialog.tsx`, `RecurringDialog.tsx`.
- `src/components/driver/TripSummaryDialog.tsx`.
- `src/components/trip/TripChatDialog.tsx`.
- `src/components/admin/FeatureEntitlementsDialog.tsx`, `CompanyBillingDialog.tsx`.

**Edited (page polish — table→card on mobile, chip filters, FAB)**
- `src/routes/_authenticated/coordinator.calendar.tsx`
- `src/routes/_authenticated/coordinator.drivers.tsx`
- `src/routes/_authenticated/coordinator.pending.tsx`
- `src/routes/_authenticated/coordinator.portal-links.tsx`
- `src/routes/_authenticated/coordinator.labels.tsx`
- `src/routes/_authenticated/coordinator.statements.tsx`
- `src/routes/_authenticated/coordinator.billing.tsx`
- `src/routes/_authenticated/coordinator.index.tsx` (dashboard cards)

## Technical notes

- Use existing `useIsMobile()` from `src/hooks/use-mobile.tsx` — no new breakpoint logic.
- Bottom tab bar uses `fixed bottom-0 inset-x-0 z-40 pb-[env(safe-area-inset-bottom)]`.
- Auto-hide header uses transform (not display) so it animates smoothly and doesn't reflow layout.
- All feature-gate filtering (`useFeatures`, `IfFeature`) stays as-is — tab items are filtered through the same list. If a pinned tab is disabled by admin, it collapses into "More" automatically to avoid empty slots.
- Responsive dialog switches by `useIsMobile()` at render time; drag-to-dismiss is provided by the existing `<Sheet>` primitive (already installed).
- Preview device viewport set to mobile so changes are visible while iterating. You can switch to tablet/desktop with the device button above the preview.

## Out of scope

- Desktop layout changes.
- Visual redesign of the auth / admin / marketing pages.
- Color palette or font family changes (kept as-is per your "Fix layout only? Full redesign?" answer — this is a structural mobile-first redesign, not a rebrand).
- Route restructuring or renaming.
- Backend, database, or feature-flag logic changes.
