
-- admin_emails: only SECURITY DEFINER fn (runs as owner) + service_role need it
REVOKE SELECT ON public.admin_emails FROM authenticated;
-- Add a deny-all policy so the RLS-enabled-no-policy linter is satisfied
CREATE POLICY "No direct access" ON public.admin_emails FOR SELECT TO authenticated USING (false);

-- is_admin: revoke broad execute, keep only authenticated (needed by RLS policy evaluation)
REVOKE EXECUTE ON FUNCTION public.is_admin(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_admin(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_admin(UUID) TO authenticated;
