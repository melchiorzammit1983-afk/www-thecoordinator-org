
-- Revoke default anon/authenticated execute from all SECURITY DEFINER helpers.
REVOKE EXECUTE ON FUNCTION public.charge_feature(uuid, feature_name, uuid, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.company_of(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.dispatch_job_forward(uuid, uuid, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.driver_accept_job(text, uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.driver_approve_deletion(text, uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_driver_assign_by_executor() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.has_connection_permission(uuid, uuid, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_admin(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_company_owner(uuid, uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_executor_of(uuid, uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.job_in_my_chain(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.respond_dispatch(uuid, text, text) FROM anon, authenticated;

-- Grant back only what the app legitimately calls via authenticated user sessions.
GRANT EXECUTE ON FUNCTION public.charge_feature(uuid, feature_name, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_job_forward(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_dispatch(uuid, text, text) TO authenticated;
