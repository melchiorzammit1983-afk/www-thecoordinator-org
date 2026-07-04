
REVOKE EXECUTE ON FUNCTION public.spend_points(uuid, text, uuid, text, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.spend_points(uuid, text, uuid, text, numeric) TO service_role;

REVOKE EXECUTE ON FUNCTION public.admin_grant_points(uuid, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_grant_points(uuid, numeric, text) TO service_role;
