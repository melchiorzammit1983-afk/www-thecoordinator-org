## Root cause

The `enforce_company_owner_update` trigger blocks any update to `companies.points_balance`, `status`, or `owner_user_id` unless `public.is_admin(auth.uid())` returns true.

All coordinator/admin server functions run through `supabaseAdmin` (service-role key). Inside a service-role request, `auth.uid()` is `NULL`, so `is_admin(NULL)` returns false and the trigger raises `only_admin_can_update_sensitive_company_fields` — even though the caller was already validated as an admin (or an authorized owner) in the server function itself.

That is why the error shows up on legitimate admin actions like top-ups, status changes, access-end extension, assigning a coordinator (`owner_user_id`), and also whenever coordinator flows indirectly touch a `companies` row.

## Fix (single migration)

Update `public.enforce_company_owner_update` so it recognizes trusted server contexts:

- Allow the update when `auth.uid() IS NULL` **and** the current Postgres role is `service_role` (our server functions using the service key). Authorization is already enforced in the server function layer (`assertAdmin`, ownership checks).
- Keep the existing admin bypass for real authenticated admin sessions.
- Keep the block for regular authenticated non-admin users trying to change `points_balance`, `status`, or `owner_user_id`.

No app code changes required — this only relaxes the trigger for the trusted service-role path we already use everywhere.

## Verification

- Admin top-up (`topUpPoints`), approve/suspend company (`setCompanyStatus`), extend access (`setAccessEnd`), and assign coordinator (`createCoordinator` → sets `owner_user_id`) should all succeed.
- A direct update from an authenticated non-admin user attempting to change those sensitive fields must still fail with `only_admin_can_update_sensitive_company_fields` (RLS + trigger both hold).
