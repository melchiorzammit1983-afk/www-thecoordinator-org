## Goal
Make the transport app much more reliable and safe by fixing the current backend permission failures, security scan issues, noisy UI warnings, and fragile mobile/runtime paths, then testing the important dashboards and portals.

## What I found from the audit
- **Current hard error:** `checkFlightStatus` in `src/lib/coordinator.functions.ts` still uses the signed-in user database client, which triggers restricted backend policies and causes `permission denied for function company_of`.
- **Same risk in many coordinator actions:** `createJob`, `updateJob`, assign/delete/split trips, bookings, magic links, labels, statements, pax moves, and flight checks still use `context.supabase` after resolving the company. Those calls can trigger restricted policy functions like `company_of`, `job_in_my_chain`, and `is_company_owner`.
- **Security scan issues remain:** security-definer function execute warnings still exist, and there is one important privilege-escalation finding: partner companies may be able to update `coordinator_connections.permissions` directly through backend policies.
- **Public token flow can be safer:** driver/client magic-link server functions still rely on database RPCs for token lookup / driver accept / deletion approval. These can be replaced with server-side validated direct logic so sensitive SQL functions do not need to be executable by public users.
- **UI warning noise:** console shows missing dialog descriptions; several dialogs still likely need `DialogDescription` for accessibility and clean logs.
- **Performance is healthy:** database health is good; slowest query is low latency, so no urgent performance rewrite is needed.

## Implementation plan

### 1. Stop coordinator permission-denied errors
- Refactor `src/lib/coordinator.functions.ts` so coordinator server functions consistently use the trusted server database client **after** `resolveCompany()` verifies the user/company.
- Replace remaining risky `context.supabase.from(...)` calls in coordinator operations with server-side queries plus explicit company checks.
- Keep user authorization manual and strict:
  - coordinator can only act on their own company or visible dispatch chain records
  - admin override only through existing admin allow-list validation
  - public/driver/client portals still require valid magic tokens

### 2. Remove public dependency on sensitive SQL RPC functions
- In `src/lib/coordinator-public.functions.ts`, replace:
  - `lookup_magic_link` RPC with direct server-side token lookup using the trusted server client
  - `driver_accept_job` RPC with direct validated job update
  - `driver_approve_deletion` RPC with direct validated deletion approval
- Preserve all existing token checks: kind, expiry, revoked status, company match, and driver match.

### 3. Fix security findings safely
- Add a database migration to:
  - revoke public/signed-in execute access from sensitive security-definer functions
  - lock down `coordinator_connections` updates so partners cannot grant themselves permissions or change connection mode
  - keep app functionality working through authorized server functions
- Re-run the security scan/linter.
- Mark only the fixed findings as fixed with the security tool after verification.

### 4. Clean UI/runtime warnings
- Add missing `DialogDescription` to dialogs that currently trigger Radix accessibility warnings.
- Check key mobile screens for overflow and unreadable layouts:
  - coordinator drivers
  - dispatch board
  - admin dashboard tabs
  - driver manifest
  - client portal

### 5. Add route-level resilience where missing
- Ensure critical routes have graceful error states instead of blank/crashed screens:
  - coordinator dashboard pages
  - admin pages
  - driver magic-link portal
  - client magic-link portal
- Error screens will offer retry/navigation, not expose technical backend details.

### 6. Verify with tests and live checks
- Use Playwright against the running app to open and inspect:
  - landing page
  - auth/admin auth pages
  - coordinator drivers page
  - coordinator dispatch board
  - driver/client token routes where available
- Check server logs after changes for:
  - no `permission denied for function company_of/is_admin/job_in_my_chain/is_company_owner`
  - no client runtime crashes
  - reduced/no dialog accessibility warnings
- Run targeted app checks and backend security/linter checks.

## Notes
- I can make the app significantly more robust, but no app can be made literally “no errors possible”; the focus will be removing known failure classes, adding safe fallbacks, and verifying the main workflows.