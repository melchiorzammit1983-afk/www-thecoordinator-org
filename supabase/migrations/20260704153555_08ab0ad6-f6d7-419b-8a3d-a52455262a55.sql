REVOKE EXECUTE ON FUNCTION public.auto_assign_job(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_assign_job(uuid) TO service_role;