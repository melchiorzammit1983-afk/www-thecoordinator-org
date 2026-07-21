-- 1) driver_vehicles: scope by driver's company vs caller's company
DROP POLICY IF EXISTS "vehicles readable in same company" ON public.driver_vehicles;
DROP POLICY IF EXISTS "vehicles manageable by company members" ON public.driver_vehicles;

CREATE POLICY "vehicles readable in same company"
  ON public.driver_vehicles FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.drivers d
      WHERE d.id = driver_vehicles.driver_id
        AND (
          d.linked_user_id = auth.uid()
          OR d.company_id = private.company_of(auth.uid())
          OR private.is_admin(auth.uid())
        )
    )
  );

CREATE POLICY "vehicles manageable by company members"
  ON public.driver_vehicles FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.drivers d
      WHERE d.id = driver_vehicles.driver_id
        AND (
          d.linked_user_id = auth.uid()
          OR d.company_id = private.company_of(auth.uid())
          OR private.is_admin(auth.uid())
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.drivers d
      WHERE d.id = driver_vehicles.driver_id
        AND (
          d.linked_user_id = auth.uid()
          OR d.company_id = private.company_of(auth.uid())
          OR private.is_admin(auth.uid())
        )
    )
  );

-- 2) Remove the mark_job_reviewed SECURITY DEFINER RPC. Callers now
--    update jobs.needs_review directly under RLS.
DROP FUNCTION IF EXISTS public.mark_job_reviewed(uuid);

-- 3) ensure_pax_tracking_token is a trigger function only. Revoke any
--    direct EXECUTE — triggers still fire via the table trigger.
REVOKE ALL ON FUNCTION public.ensure_pax_tracking_token() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_pax_tracking_token() FROM anon;
REVOKE ALL ON FUNCTION public.ensure_pax_tracking_token() FROM authenticated;