
-- 1) Revoke EXECUTE from PUBLIC/authenticated on SECURITY DEFINER functions.
--    All callers use the service-role admin client in server functions.
REVOKE EXECUTE ON FUNCTION public.admin_grant_ai_points(uuid, numeric, text) FROM PUBLIC, authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.allocate_to_ai_wallet(uuid, numeric)       FROM PUBLIC, authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.driver_guide_consume(uuid, uuid)           FROM PUBLIC, authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.set_ai_fallback(uuid, boolean)             FROM PUBLIC, authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.set_ai_monthly_cap(uuid, numeric)          FROM PUBLIC, authenticated, anon;
GRANT  EXECUTE ON FUNCTION public.admin_grant_ai_points(uuid, numeric, text) TO service_role;
GRANT  EXECUTE ON FUNCTION public.allocate_to_ai_wallet(uuid, numeric)       TO service_role;
GRANT  EXECUTE ON FUNCTION public.driver_guide_consume(uuid, uuid)           TO service_role;
GRANT  EXECUTE ON FUNCTION public.set_ai_fallback(uuid, boolean)             TO service_role;
GRANT  EXECUTE ON FUNCTION public.set_ai_monthly_cap(uuid, numeric)          TO service_role;

-- 2) Tighten admin email-based policies: require verified/confirmed email so a
--    caller cannot claim admin by setting an unverified email address matching
--    an admin_emails entry.
DROP POLICY IF EXISTS "Admins can read activity log" ON public.admin_activity_log;
CREATE POLICY "Admins can read activity log" ON public.admin_activity_log
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.admin_emails ae
      JOIN auth.users u ON lower(u.email) = lower(ae.email)
      WHERE u.id = auth.uid() AND u.email_confirmed_at IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "coord view own ai command log" ON public.ai_command_log;
CREATE POLICY "coord view own ai command log" ON public.ai_command_log
  FOR SELECT TO authenticated USING (
    (company_id IN (SELECT c.id FROM public.companies c WHERE c.owner_user_id = auth.uid()))
    OR EXISTS (
      SELECT 1 FROM public.admin_emails ae
      JOIN auth.users u ON lower(u.email) = lower(ae.email)
      WHERE u.id = auth.uid() AND u.email_confirmed_at IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "coord manage own ai config" ON public.ai_configuration;
CREATE POLICY "coord manage own ai config" ON public.ai_configuration
  FOR ALL TO authenticated
  USING (
    (company_id IN (SELECT c.id FROM public.companies c WHERE c.owner_user_id = auth.uid()))
    OR EXISTS (
      SELECT 1 FROM public.admin_emails ae
      JOIN auth.users u ON lower(u.email) = lower(ae.email)
      WHERE u.id = auth.uid() AND u.email_confirmed_at IS NOT NULL
    )
  )
  WITH CHECK (
    (company_id IN (SELECT c.id FROM public.companies c WHERE c.owner_user_id = auth.uid()))
    OR EXISTS (
      SELECT 1 FROM public.admin_emails ae
      JOIN auth.users u ON lower(u.email) = lower(ae.email)
      WHERE u.id = auth.uid() AND u.email_confirmed_at IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "coord manage own ai rules" ON public.company_ai_rules;
CREATE POLICY "coord manage own ai rules" ON public.company_ai_rules
  FOR ALL TO authenticated
  USING (
    (company_id IN (SELECT c.id FROM public.companies c WHERE c.owner_user_id = auth.uid()))
    OR EXISTS (
      SELECT 1 FROM public.admin_emails ae
      JOIN auth.users u ON lower(u.email) = lower(ae.email)
      WHERE u.id = auth.uid() AND u.email_confirmed_at IS NOT NULL
    )
  )
  WITH CHECK (
    (company_id IN (SELECT c.id FROM public.companies c WHERE c.owner_user_id = auth.uid()))
    OR EXISTS (
      SELECT 1 FROM public.admin_emails ae
      JOIN auth.users u ON lower(u.email) = lower(ae.email)
      WHERE u.id = auth.uid() AND u.email_confirmed_at IS NOT NULL
    )
  );

-- 3) Rate-limit anonymous client_bookings inserts to curb PII injection abuse.
--    Extend the existing validator trigger with a per-email/per-company hourly cap.
CREATE OR REPLACE FUNCTION public.validate_public_client_booking()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE _recent int;
BEGIN
  IF auth.uid() IS NULL THEN
    NEW.status := 'pending'::booking_status;

    IF length(coalesce(NEW.name,'')) = 0 OR length(NEW.name) > 80 THEN RAISE EXCEPTION 'invalid_name'; END IF;
    IF length(coalesce(NEW.surname,'')) = 0 OR length(NEW.surname) > 80 THEN RAISE EXCEPTION 'invalid_surname'; END IF;
    IF length(coalesce(NEW.client_email,'')) = 0 OR length(NEW.client_email) > 200
       OR NEW.client_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'invalid_email'; END IF;
    IF length(coalesce(NEW.from_location,'')) = 0 OR length(NEW.from_location) > 200 THEN RAISE EXCEPTION 'invalid_from_location'; END IF;
    IF length(coalesce(NEW.to_location,'')) = 0 OR length(NEW.to_location) > 200 THEN RAISE EXCEPTION 'invalid_to_location'; END IF;
    IF NEW.room_number IS NOT NULL AND length(NEW.room_number) > 40 THEN RAISE EXCEPTION 'invalid_room_number'; END IF;
    IF NEW.pickup_at IS NOT NULL AND NEW.pickup_at < now() - interval '1 day' THEN RAISE EXCEPTION 'invalid_pickup_at'; END IF;

    -- Per-email/per-company rate limit: max 5 pending bookings per hour.
    SELECT count(*) INTO _recent
      FROM public.client_bookings
      WHERE company_id = NEW.company_id
        AND lower(client_email) = lower(NEW.client_email)
        AND created_at > now() - interval '1 hour';
    IF _recent >= 5 THEN
      RAISE EXCEPTION 'rate_limited';
    END IF;

    -- Per-company global soft cap for anon inserts: max 60 per hour.
    SELECT count(*) INTO _recent
      FROM public.client_bookings
      WHERE company_id = NEW.company_id
        AND created_at > now() - interval '1 hour';
    IF _recent >= 60 THEN
      RAISE EXCEPTION 'rate_limited';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- 4) Lock trip_audit_log against tampering via UPDATE/DELETE from any role
--    except service_role (server-only). INSERT is already blocked; SELECT
--    policies remain unchanged. Add explicit deny to make intent auditable.
DROP POLICY IF EXISTS "Block trip audit updates" ON public.trip_audit_log;
CREATE POLICY "Block trip audit updates" ON public.trip_audit_log
  FOR UPDATE TO authenticated, anon USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS "Block trip audit deletes" ON public.trip_audit_log;
CREATE POLICY "Block trip audit deletes" ON public.trip_audit_log
  FOR DELETE TO authenticated, anon USING (false);
COMMENT ON TABLE public.trip_audit_log IS
  'Append-only audit chain. Writes MUST go through public.record_trip_audit (SECURITY DEFINER) which computes prev_hash/row_hash server-side. Direct INSERT/UPDATE/DELETE from authenticated/anon is denied by RLS.';
