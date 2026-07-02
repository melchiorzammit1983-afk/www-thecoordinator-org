## Goal

- Coordinators sign in with **phone number + password** (no SMS/OTP — simplest, works today with Supabase phone auth).
- Admin keeps **email + password** sign-in and remains a single, protected account.
- On first sign-in with the admin-issued password, coordinator sees a **modal to set a new password** before they can use the dashboard.

## Changes

### 1. Auth mode
- Enable Supabase phone auth (password grant, no SMS provider needed) via `supabase--configure_auth`. Email signup stays enabled for the admin only.
- Coordinator accounts are created by admin with `supabaseAdmin.auth.admin.createUser({ phone, password, phone_confirm: true, user_metadata: { must_change_password: true, role: 'coordinator' } })` — no email required.
- Admin sign-in path (`/admin-auth`) is unchanged (email + password).
- Coordinator sign-in path (`/auth`) swaps the email field for a phone-number field (E.164, with a simple country-code helper) and calls `supabase.auth.signInWithPassword({ phone, password })`.

### 2. Single admin enforcement
- `admin_emails` table already gates admin access. Add a DB check/trigger so it holds **at most one row**; server function `createAdmin` refuses if one already exists.
- Admin creation UI (if any) is hidden once an admin exists; the seeded admin cannot be duplicated.

### 3. Admin coordinator management
- Replace the "Email" field in the create/edit coordinator dialog with a **Phone number** field + initial password (already there).
- Store phone on `companies.phone` (add column) for display; auth user's `phone` is the source of truth.
- `deleteCoordinator` continues to work by user id.
- Existing email-based coordinators: admin can attach a phone via an "Add phone number" action per row (calls `supabaseAdmin.auth.admin.updateUserById`). Until then, they can still sign in via email on a hidden fallback (kept internally, not shown in UI).

### 4. Forced password change on first login
- On coordinator creation, set `user_metadata.must_change_password = true`.
- Add a global gate in `src/routes/_authenticated/coordinator.tsx` that reads `supabase.auth.getUser()` and, if `user_metadata.must_change_password === true`, renders a blocking `ChangePasswordDialog` (cannot dismiss) instead of the dashboard.
- Submitting the dialog calls `supabase.auth.updateUser({ password, data: { must_change_password: false } })`, then refreshes the session.
- Admin is exempt (flag never set on the admin account).

### 5. Copy / UX
- Update landing page, sign-in card, and any help text that says "email" for coordinators to say "phone number".
- Sign-in error messages localized: invalid phone format, wrong password, account disabled.

## Technical notes

- No SMS provider, no OTP: uses Supabase's phone+password grant. Users never receive an SMS.
- Phone stored in E.164 (e.g. `+35699123456`). Client-side validation with a light regex; server trusts Supabase's validation.
- `admin_emails` singleton enforced with a partial unique index or `CHECK ((SELECT count(*) FROM admin_emails) <= 1)` via trigger.
- Migration adds `companies.phone TEXT` (nullable) and the admin singleton trigger. Grants unchanged.
- No changes to magic links, driver portal, or partner flows — those are token-based and unrelated to auth.

## Out of scope

- SMS OTP / passwordless phone login.
- Migrating existing email coordinators automatically (admin does it per user when convenient).
- Password strength rules beyond Supabase defaults.
