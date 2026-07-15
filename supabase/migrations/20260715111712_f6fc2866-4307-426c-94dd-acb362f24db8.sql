
REVOKE EXECUTE ON FUNCTION public.record_trip_audit(
  uuid, text, jsonb, jsonb, text, numeric, numeric, numeric, text, numeric,
  timestamptz, uuid, uuid, text, uuid, text
) FROM anon, public;

REVOKE EXECUTE ON FUNCTION public.verify_trip_audit_chain(uuid) FROM anon, public;

CREATE POLICY "Company owners create stop reorder requests"
  ON public.group_stop_reorder_requests FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.groups g
    JOIN public.jobs j ON j.id = g.job_id
    WHERE g.id = group_stop_reorder_requests.group_id
      AND j.company_id = private.company_of(auth.uid())
  ));
