DROP POLICY IF EXISTS chain_can_read_driver_locations ON public.driver_locations;

CREATE POLICY assigned_company_can_read_driver_locations
ON public.driver_locations
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.jobs j
    WHERE j.id = driver_locations.job_id
      AND private.company_of(auth.uid()) IS NOT NULL
      AND (
        j.company_id = private.company_of(auth.uid())
        OR j.executor_company_id = private.company_of(auth.uid())
      )
  )
);