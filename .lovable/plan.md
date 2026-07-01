## Coordinator Dashboard & Dispatch System

### 1. Coordinator identity model
- Admin creates a company and assigns a coordinator by email in the existing admin UI. When that user signs up (or is already signed up), a trigger fills `companies.owner_user_id`.
- Add table `public.company_coordinator_invites (company_id, email, invited_at)`. Trigger `on_auth_user_created` matches by email → sets `companies.owner_user_id` and removes the invite.
- `_authenticated/coordinator` route resolves the coordinator's company by `owner_user_id = auth.uid()`. If none → friendly "no company assigned" screen. Admins accessing `/coordinator` see a company-picker.

### 2. Schema migrations
- `jobs`: add `qr_strict_mode boolean default false`, `driver_id uuid → drivers`, `vehicle text`, `pickup_at timestamptz` (generated from date+time when null), `points_charged jsonb default '{}'` (which features already billed on this job — prevents double-charge on toggle-off/on).
- `client_bookings`: add `pickup_at timestamptz not null`, `date date`, `job_id uuid null → jobs` (set when approved), rename status enum to include `pending, approved, rejected, modification_pending`.
- New table `public.client_booking_modifications (id, booking_id, requested_changes jsonb, requested_at, status: pending/approved/rejected, resolved_at, resolved_by)`. Only auto-created when a client edits within 2h of `pickup_at` — enforced by a BEFORE UPDATE trigger on `client_bookings` that intercepts changes and inserts a modification row instead of mutating the booking.
- New table `public.magic_links (id, company_id, kind: driver|client, subject_id uuid, token text unique, expires_at, created_by, revoked_at)`. Token = 32-byte random hex.
- `drivers`: add `email text`, `vehicle text`.
- `feature_costs`: seed additional feature keys: `tracking, qr, client_booking, bulkupload, magic_link_driver, magic_link_client, split_job, clone_job, recurring_schedule`.

### 3. RLS (coordinator scope)
For every company-scoped table (`jobs`, `pax`, `groups`, `drivers`, `driver_status_updates`, `client_bookings`, `client_booking_modifications`, `points_ledger`, `magic_links`), add policies:
- `SELECT/INSERT/UPDATE/DELETE` where `company_id` (or ancestor's `company_id`) belongs to a company owned by `auth.uid()`.
- Admin ALL policies remain via `is_admin(auth.uid())`.
- Public unauthenticated portal reads for `magic_links` are done via server functions using the publishable client + narrow SELECT policy `TO anon` scoped by `token = ? AND revoked_at IS NULL AND expires_at > now()`.

### 4. Points-charging RPC
- SQL function `public.charge_feature(_company_id uuid, _feature feature_name, _job_id uuid, _note text) returns integer` — SECURITY DEFINER.
  - Locks the company row, reads cost from `feature_costs`; if cost = 0, records a $0 ledger row and returns balance.
  - Else deducts, writes `points_ledger` entry, returns new balance.
  - Raises `insufficient_points` when balance < cost so server functions can throw a typed error → UI shows "Top-Up Required".
- Every premium server action (`toggleTracking`, `toggleQrStrict`, `approveClientBooking`, `bulkUploadPax`, `splitJob`, `cloneJob`, `createRecurringSchedule`, `generateMagicLink`) calls this RPC first (except when `jobs.points_charged` already recorded that feature for that job).

### 5. Coordinator server functions (`src/lib/coordinator.functions.ts`)
All use `requireSupabaseAuth` + a `assertCoordinator(context)` helper returning `{ companyId, balance }`.
- `getDashboardSummary` — balance, counts (pending bookings, unassigned jobs, today's trips).
- `listJobs({ from, to })` — jobs joined with driver, pax count, groups.
- `listDrivers`, `listUnassignedJobs`.
- `createJob`, `updateJob(fields incl. qr_strict_mode, tracking_enabled)`, `assignDriver(job_id, driver_id)`, `splitJob(job_id, groups[])`, `cloneJob(job_id, target_date)`.
- `listPendingBookings` (status in pending/modification_pending), `approveBooking(id)` (charges `client_booking`, creates job), `rejectBooking(id)`.
- `approveModification(id)` / `rejectModification(id)`.
- `topUpRequest` — stub that pings admin (writes to a `topup_requests` table); admin fulfils via existing admin ledger UI.
- `generateMagicLink({ kind, subject_id, ttl_hours })` — charges appropriate feature, inserts `magic_links`, returns full URL.
- `listMagicLinks`, `revokeMagicLink`.

### 6. Public magic-link routes
- `src/routes/m.driver.$token.tsx` — read-only daily manifest (jobs assigned to that driver, pax lists).
- `src/routes/m.client.$token.tsx` — client's own bookings (view + edit; edits within 2h trigger the modification workflow).
- Both fetch via public server functions that validate token → return only the scoped payload.

### 7. Coordinator UI (`src/routes/_authenticated/coordinator*`)
Layout: sidebar with sections (Dashboard, Calendar, Pending, Drivers, Portal Links, Settings) + points balance header.

**Points header component**
- Sticky top bar: current balance, low-balance amber ≤ 50, red = 0. "Top Up" button opens modal that records a top-up request.
- Global `usePoints()` hook returns `{ balance, canAfford(featureName) }`. Any premium button uses `<PremiumButton feature="..." />` that:
  - Reads cost from cached `feature_costs`.
  - If `cost === 0`: normal button.
  - If `balance < cost`: greyed out with tooltip "Top-Up Required". Click → opens Top-Up modal.

**Calendar & dispatch board** (`coordinator.calendar.tsx`)
- View toggle: Day / Week. Built with a lightweight custom grid (hours × days) — no external calendar dep.
- Left column: "Unassigned trips" list. Right: driver lanes (Day view) or days (Week view).
- Drag-and-drop via `@dnd-kit/core` (add dep). Dropping a card on a driver lane calls `assignDriver`.
- Trip card actions: Split (opens modal to split pax into new groups → creates sibling jobs), Clone (date picker → duplicates job for chosen date), Edit, Assign.

**Create/Edit trip modal**
- Fields: from, to, date, time, flight/ship, client company. Toggles: `Require QR Code Verification` (`qr_strict_mode`), `Enable Live Tracking` (`tracking_enabled`). Both wrapped in `PremiumButton` semantics.

**Pending Approvals panel** (`coordinator.pending.tsx`)
- Two tabs: `New bookings` and `Modification pending` (2-hour rule).
- Each card: booking details, diff (for modifications), Approve/Reject buttons. Approve charges points and creates/updates job.

**Portal Links section** (`coordinator.portal-links.tsx`)
- Two tabs: Drivers, Clients. Row per subject with "Generate link" (choose TTL 1/8/24/72h), copy-to-clipboard, revoke, expiry countdown.

### 8. Admin additions
- On company creation, admin sets `coordinator_email` → inserts into `company_coordinator_invites`.
- Admin ledger page unchanged; add "Top-Up Requests" tab reading `topup_requests`.

### Technical notes
- Add dependency: `@dnd-kit/core`, `@dnd-kit/sortable`, `date-fns` (already present? verify).
- All server fns follow existing pattern (`createServerFn` + Zod validator + `requireSupabaseAuth`).
- `src/start.ts` already has bearer middleware — no change.
- Deferred/optional: recurring schedules (surface as button that charges `recurring_schedule` and creates N cloned jobs). Full RRULE UI can be a follow-up.

### File map (new)
```
src/lib/coordinator.functions.ts
src/lib/coordinator-public.functions.ts       # magic-link portals
src/hooks/use-coordinator.ts                  # balance, feature costs, canAfford
src/components/coordinator/PointsHeader.tsx
src/components/coordinator/PremiumButton.tsx
src/components/coordinator/TopUpModal.tsx
src/components/coordinator/TripCard.tsx
src/components/coordinator/CalendarBoard.tsx
src/components/coordinator/JobFormDialog.tsx
src/components/coordinator/SplitJobDialog.tsx
src/components/coordinator/CloneJobDialog.tsx
src/routes/_authenticated/coordinator.tsx     # layout + sidebar
src/routes/_authenticated/coordinator.index.tsx        # dashboard summary
src/routes/_authenticated/coordinator.calendar.tsx
src/routes/_authenticated/coordinator.pending.tsx
src/routes/_authenticated/coordinator.drivers.tsx
src/routes/_authenticated/coordinator.portal-links.tsx
src/routes/m.driver.$token.tsx
src/routes/m.client.$token.tsx
```

Verification: `tsgo` typecheck, then a quick Playwright pass: sign in as coordinator, create job, drag to driver, toggle QR (points deducted), submit client booking on `/c/$token` within 2h → appears in Pending as Modification.
