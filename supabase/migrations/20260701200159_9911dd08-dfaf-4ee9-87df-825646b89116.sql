
ALTER FUNCTION public.enforce_company_owner_update() SECURITY INVOKER;
ALTER FUNCTION public.enforce_hop_immutable_fields() SECURITY INVOKER;
ALTER FUNCTION public.enforce_jobs_partner_update() SECURITY INVOKER;
ALTER FUNCTION public.enforce_driver_self_update() SECURITY INVOKER;

REVOKE ALL ON FUNCTION public.enforce_company_owner_update() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_hop_immutable_fields() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_jobs_partner_update() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_driver_self_update() FROM PUBLIC, anon, authenticated;
