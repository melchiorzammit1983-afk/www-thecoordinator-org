## Crew-Change Transport — Database + Admin Dashboard (Phase 1)

### 1. Enable Lovable Cloud
Provision backend (Postgres + Auth). No dummy data anywhere.

### 2. Database schema (single migration)

Enums:
- `company_status`: pending, approved, suspended
- `job_status`: pending, active, completed
- `pax_status`: pending, verified, onboard, delayed, noshow, completed
- `group_status`: pending, assigned, active, completed
- `driver_status`: available, busy, offline
- `booking_status`: pending, accepted, rejected
- `feature_name`: tracking, bulkupload, client_booking, qr

Tables (all UUID PKs via `gen_random_uuid()`, timestamps in UTC, distances/coords in metric units — lat/lng float, ETA stored as `time`):
- `companies` — name, email (unique), phone, access_end timestamptz, points_balance int default 0, custom_link text unique, require_client_company bool default true, status company_status default 'pending', owner_user_id uuid (nullable, links to auth.users so a company owner can later sign in)
- `feature_costs` — feature_name PK, points_cost int default 0. Seeded: tracking=0, bulkupload=0, client_booking=0, qr=0 (admin edits later; bulkupload explicitly free)
- `points_ledger` — company_id FK, job_id FK nullable, feature_used feature_name, points_deducted int, created_at timestamptz default now()
- `jobs` — company_id FK, clientcompanyname, from_location, to_location, date date, time time, flightorship, tracking_enabled bool, status job_status
- `pax` — job_id FK, group_id FK nullable, name, status pax_status, qr_code text unique default `encode(gen_random_bytes(24),'hex')`
- `groups` — job_id FK, name, driver_id FK nullable, driver_link text unique default secure token, meetandgreet_sign, coordinator_note text, status group_status
- `drivers` — company_id FK, name, phone, status driver_status
- `client_bookings` — company_id FK, name, surname, client_email, room_number nullable, from_location, to_location, time time, status booking_status default 'pending', created_at
- `driver_status_updates` — driver_id FK, group_id FK, location_lat float, location_lng float, estimated_eta time, created_at timestamptz

All tables: GRANT statements + RLS enabled with policies (see Security below).

### 3. Auth & admin authorization
- Email + password auth.
- Admin = single hardcoded email stored in `ADMIN_EMAIL` secret + a SQL `is_admin(uid)` SECURITY DEFINER function that checks `auth.users.email = current_setting('app.admin_email')` via a `public.admin_emails` table seeded with that one email (so it's queryable from RLS without secrets).
- `/auth` public route (sign in / sign up).
- `/admin/*` lives under `_authenticated/` and additionally checks `is_admin` in `beforeLoad`; non-admins get redirected.

### 4. RLS policy summary
- `companies`, `feature_costs`, `points_ledger`, all operational tables: admin full access via `is_admin(auth.uid())`.
- `companies`: company owner can SELECT own row.
- `client_bookings`: **anon INSERT allowed** (the public custom-link form) with a CHECK that the company exists and is `approved`; SELECT restricted to admin + company owner.
- All other tables: no anon access.

### 5. Public custom company link
- Route `/c/$token` (top-level, public, SSR on).
- Loader calls a public `createServerFn` using the server publishable client to look up the company by `custom_link` (selecting only `id`, `name`, `require_client_company`, `status`); 404 if not approved.
- Renders a validated client-booking form (zod: name, surname, email, optional room, from, to, time). Submits via another public server fn that inserts into `client_bookings` with `status='pending'`.

### 6. Admin Dashboard UI (`/admin`)
Clean responsive layout (sidebar + content). Pages:
1. **Companies** — table of all companies with: name, email, status badge, points balance, access expiry, custom link (copy button). Row actions:
   - Approve / Suspend (status toggle)
   - Top-up points (dialog → integer input; writes new balance + inserts ledger row with `feature_used` null... actually ledger is for deductions; top-ups go to a separate `points_deducted` negative entry so audit is complete)
   - Set access expiry (date picker → access_end)
   - Regenerate custom link
   - Edit `require_client_company` toggle
2. **Feature Costs** — editable table of the 4 features with inline integer inputs + Save. bulkupload row labeled "Free" when 0.
3. **Points Audit** — paginated table of `points_ledger` joined with company name + job id, newest first, filter by company.

All admin mutations go through `createServerFn` with `requireSupabaseAuth` + server-side admin check (defense in depth beyond RLS).

### 7. Design
- Modern operations-console aesthetic: neutral slate background, single accent (deep teal `#0E7C7B`), Inter font via `@fontsource/inter`.
- shadcn components (Table, Dialog, Badge, Button, Input, Switch, Tabs, Sonner toasts).
- Mobile-first: sidebar collapses to drawer < md.

### 8. Out of scope (later phases)
Jobs/Pax/Groups/Drivers/QR/tracking UI, company-side dashboard, driver portal, bulk upload, points deduction triggers on feature use. Schema is in place so those modules drop in cleanly.

### Technical notes
- Migration order per table: CREATE → GRANT (authenticated + service_role; anon only where stated) → ENABLE RLS → CREATE POLICY.
- `custom_link` and `qr_code` / `driver_link` defaults use `encode(gen_random_bytes(24),'hex')` for unguessable tokens.
- `ADMIN_EMAIL` collected via `add_secret` after Cloud is enabled; seeded into `admin_emails` table by a follow-up insert.
- TanStack Start patterns: protected routes under `_authenticated/`, public `/c/$token` and `/auth` top-level, server fns in `src/lib/*.functions.ts`.
