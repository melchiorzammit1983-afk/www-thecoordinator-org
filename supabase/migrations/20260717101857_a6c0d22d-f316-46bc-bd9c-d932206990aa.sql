-- Revoke public execute on the new SECURITY DEFINER RPCs; grant to authenticated only.
REVOKE ALL ON FUNCTION public.allocate_to_ai_wallet(uuid, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_grant_ai_points(uuid, numeric, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_ai_monthly_cap(uuid, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_ai_fallback(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.driver_guide_consume(uuid, uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.allocate_to_ai_wallet(uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_grant_ai_points(uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_ai_monthly_cap(uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_ai_fallback(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.driver_guide_consume(uuid, uuid) TO service_role;
