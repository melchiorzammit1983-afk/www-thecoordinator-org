# Optional AI Module Removal — Phase 1

## Goal

Make the core transport platform operate without the built-in AI experience while preserving normal dispatch, trip, driver, routing, support, billing, and spreadsheet-import workflows.

## Completed in this phase

- Removed the global help guide, coordinator assistant, sales chatbot, voice extraction, route-optimization assistant, and live-flight refresh controls.
- Removed AI navigation, quick actions, settings, learning screens, marketing claims, and help content.
- Redirected old authenticated AI URLs to safe core pages so existing bookmarks do not break the app.
- Disabled public AI chat, learning-summary, automatic-coordination, and flight-refresh endpoints.
- Added a server-side master lock that blocks the retained provider adapters.
- Preserved local Excel/CSV bulk trip import and deterministic address, traffic, conflict, grouping, and operations-monitor features.
- Removed AI billing controls and stopped flight creation from charging AI-related points.

## Deliberately retained for Phase 2

- Existing database tables, columns, migrations, audit history, and historical billing records.
- Mixed legacy backend functions that share a large file with core transport actions.
- Provider packages still referenced by those retained backend files.
- Legacy route filenames required by the generated route tree; these routes now only redirect.

These items should be removed only after a database dependency map and production-data backup are reviewed.

## Verification notes

- TypeScript checking reports only the existing `company is possibly undefined` errors in `src/routes/c.$token.tsx`; this phase introduced no additional TypeScript errors.
- The repository's Vite production build is already blocked on Windows by the Lovable MCP route-directory path check. That baseline tooling issue is separate from this phase.
- `git diff --check` passes; line-ending notices are caused by the repository's existing Windows checkout configuration.

## Manual review checklist

1. Sign in as a coordinator and confirm the dashboard, calendar, trips, groups, drivers, and dispatch board open normally.
2. Create one manual trip and one bulk trip from Excel or CSV.
3. Edit, assign, reschedule, and complete a test trip.
4. Confirm Settings shows Automation & Routing without AI controls.
5. Confirm old AI URLs redirect to the coordinator, admin, activity, pricing, or billing pages.
6. Confirm support tickets can still be created, viewed, replied to, and closed.
7. Confirm traffic and address lookup still work when their normal map-provider credentials are configured.
