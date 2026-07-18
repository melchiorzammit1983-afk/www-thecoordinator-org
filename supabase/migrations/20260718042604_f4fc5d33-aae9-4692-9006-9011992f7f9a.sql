-- Finding 1: client_bookings — tighten anonymous insert with per-company rate limit + explicit basic validation
CREATE TABLE IF NOT EXISTS public.client_booking_rate_limits (
  company_id uuid NOT NULL,
  window_start timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (company_id, window_start)
);
GRANT ALL ON public.client_booking_rate_limits TO service_role;
ALTER TABLE public.client_booking_rate_limits ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.register_client_booking_attempt(_company_id uuid, _limit int DEFAULT 20)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _bucket timestamptz := date_trunc('minute', now());
  _count int;
BEGIN
  DELETE FROM public.client_booking_rate_limits
    WHERE window_start < now() - interval '10 minutes';
  INSERT INTO public.client_booking_rate_limits(company_id, window_start, count)
    VALUES (_company_id, _bucket, 1)
    ON CONFLICT (company_id, window_start)
      DO UPDATE SET count = public.client_booking_rate_limits.count + 1
    RETURNING count INTO _count;
  RETURN _count <= _limit;
END;
$$;
REVOKE ALL ON FUNCTION public.register_client_booking_attempt(uuid, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_client_booking_attempt(uuid, int) TO service_role;

-- Finding 2: job_price_proposals — add driver-side SELECT/UPDATE policies for the linked driver user
DROP POLICY IF EXISTS "Assigned driver can view their proposals" ON public.job_price_proposals;
CREATE POLICY "Assigned driver can view their proposals"
ON public.job_price_proposals FOR SELECT
TO authenticated
USING (
  to_driver_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.drivers d
    WHERE d.id = job_price_proposals.to_driver_id
      AND d.linked_user_id = auth.uid()
  )
  OR (
    from_driver_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.drivers d
      WHERE d.id = job_price_proposals.from_driver_id
        AND d.linked_user_id = auth.uid()
    )
  )
);

DROP POLICY IF EXISTS "Assigned driver can respond to their proposals" ON public.job_price_proposals;
CREATE POLICY "Assigned driver can respond to their proposals"
ON public.job_price_proposals FOR UPDATE
TO authenticated
USING (
  to_driver_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.drivers d
    WHERE d.id = job_price_proposals.to_driver_id
      AND d.linked_user_id = auth.uid()
  )
)
WITH CHECK (
  to_driver_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.drivers d
    WHERE d.id = job_price_proposals.to_driver_id
      AND d.linked_user_id = auth.uid()
  )
);