REVOKE ALL ON FUNCTION public.apply_referral_kickback() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.link_referral_on_approve() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ensure_referral_code(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_referral_code(uuid) TO authenticated, service_role;