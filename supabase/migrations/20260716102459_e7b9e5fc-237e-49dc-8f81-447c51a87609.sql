
-- 1) driver_locations: restrict chain read to authenticated only
DROP POLICY IF EXISTS "chain_can_read_driver_locations" ON public.driver_locations;
CREATE POLICY "chain_can_read_driver_locations"
  ON public.driver_locations
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.id = driver_locations.job_id
        AND private.company_of(auth.uid()) IS NOT NULL
        AND (
          j.company_id           = private.company_of(auth.uid())
          OR j.executor_company_id = private.company_of(auth.uid())
          OR j.origin_company_id   = private.company_of(auth.uid())
        )
    )
  );

-- 2) Service-role-only tables: re-scope to service_role role so the policy
--    surface never evaluates for anon/authenticated sessions.

-- email_send_state
DROP POLICY IF EXISTS "Service role can manage send state" ON public.email_send_state;
CREATE POLICY "Service role can manage send state"
  ON public.email_send_state
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- email_send_log
DROP POLICY IF EXISTS "Service role can insert send log" ON public.email_send_log;
DROP POLICY IF EXISTS "Service role can read send log"   ON public.email_send_log;
DROP POLICY IF EXISTS "Service role can update send log" ON public.email_send_log;
CREATE POLICY "Service role can insert send log"
  ON public.email_send_log FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "Service role can read send log"
  ON public.email_send_log FOR SELECT TO service_role USING (true);
CREATE POLICY "Service role can update send log"
  ON public.email_send_log FOR UPDATE TO service_role USING (true) WITH CHECK (true);

-- email_unsubscribe_tokens
DROP POLICY IF EXISTS "Service role can insert tokens"       ON public.email_unsubscribe_tokens;
DROP POLICY IF EXISTS "Service role can mark tokens as used" ON public.email_unsubscribe_tokens;
DROP POLICY IF EXISTS "Service role can read tokens"         ON public.email_unsubscribe_tokens;
CREATE POLICY "Service role can insert tokens"
  ON public.email_unsubscribe_tokens FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "Service role can mark tokens as used"
  ON public.email_unsubscribe_tokens FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role can read tokens"
  ON public.email_unsubscribe_tokens FOR SELECT TO service_role USING (true);

-- suppressed_emails
DROP POLICY IF EXISTS "Service role can insert suppressed emails" ON public.suppressed_emails;
DROP POLICY IF EXISTS "Service role can read suppressed emails"   ON public.suppressed_emails;
CREATE POLICY "Service role can insert suppressed emails"
  ON public.suppressed_emails FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "Service role can read suppressed emails"
  ON public.suppressed_emails FOR SELECT TO service_role USING (true);

-- 3) portal-logos: restrict SELECT to owning coordinator + admin.
--    Server code uses the service role and bypasses RLS, so public-facing
--    portal pages that need the logo will continue to work via signed URLs
--    minted server-side.
DROP POLICY IF EXISTS "anyone can read portal logos" ON storage.objects;
CREATE POLICY "coordinator can read portal logos"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'portal-logos'
    AND EXISTS (
      SELECT 1 FROM public.portal_companies pc
      WHERE pc.id::text = split_part(objects.name, '/', 1)
        AND (
          private.company_of(auth.uid()) = pc.coordinator_company_id
          OR private.is_admin(auth.uid())
        )
    )
  );
