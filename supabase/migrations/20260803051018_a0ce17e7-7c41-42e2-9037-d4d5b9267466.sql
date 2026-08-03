-- 1) Pin search_path and revoke public execute on internal helper functions
ALTER FUNCTION public.derive_operation_name(text, text, text, text) SET search_path = public;
ALTER FUNCTION public.ensure_job_operation_id() SET search_path = public;
ALTER FUNCTION public.mirror_job_to_transport_core() SET search_path = public;
ALTER FUNCTION public.mirror_pax_to_transport_core() SET search_path = public;
ALTER FUNCTION public.refresh_trip_stops_for_job(uuid, uuid, text, text, text, text, text) SET search_path = public;
ALTER FUNCTION public.touch_transport_updated_at() SET search_path = public;

REVOKE ALL ON FUNCTION public.derive_operation_name(text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ensure_job_operation_id() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mirror_job_to_transport_core() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mirror_pax_to_transport_core() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_trip_stops_for_job(uuid, uuid, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.touch_transport_updated_at() FROM PUBLIC, anon, authenticated;

-- 2) Explicit deny-all for service-role-only tables (RLS already enabled, no grants)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'client_booking_rate_limits','crew_login_codes','portal_addons',
    'portal_guest_sessions','portal_rate_limits','public_ai_daily_counters'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('DROP POLICY IF EXISTS "No client access" ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY "No client access" ON public.%I AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)', t);
  END LOOP;
END $$;