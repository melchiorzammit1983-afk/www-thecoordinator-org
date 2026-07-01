
REVOKE EXECUTE ON FUNCTION public.enforce_two_hour_rule() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.link_coordinator_on_signup() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;
