-- Phase 2: driver on-the-go trip creation
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS created_by_driver boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS needs_review boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS jobs_needs_review_idx
  ON public.jobs (company_id) WHERE needs_review = true;

-- Allow the assigned driver to add/update stops on their own job (used when
-- OTG driver taps "Add another stop"). Existing coordinator/admin policies
-- remain untouched.
DO $mig$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
      WHERE schemaname='public' AND tablename='group_stops'
        AND policyname='Assigned driver appends stops'
  ) THEN
    CREATE POLICY "Assigned driver appends stops"
      ON public.group_stops FOR INSERT TO authenticated
      WITH CHECK (EXISTS (
        SELECT 1 FROM public.groups g
        JOIN public.jobs j ON j.id = g.job_id
        JOIN public.drivers d ON d.id = j.driver_id
        WHERE g.id = group_stops.group_id
          AND d.linked_user_id = auth.uid()
      ));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
      WHERE schemaname='public' AND tablename='group_stops'
        AND policyname='Assigned driver updates stops'
  ) THEN
    CREATE POLICY "Assigned driver updates stops"
      ON public.group_stops FOR UPDATE TO authenticated
      USING (EXISTS (
        SELECT 1 FROM public.groups g
        JOIN public.jobs j ON j.id = g.job_id
        JOIN public.drivers d ON d.id = j.driver_id
        WHERE g.id = group_stops.group_id
          AND d.linked_user_id = auth.uid()
      ));
  END IF;
END $mig$;

-- Mark a driver-created trip as reviewed by the coordinator that owns it.
CREATE OR REPLACE FUNCTION public.mark_job_reviewed(_job_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  _uid uuid := auth.uid();
  _co  uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT company_id INTO _co FROM public.jobs WHERE id = _job_id;
  IF _co IS NULL THEN RAISE EXCEPTION 'job_not_found'; END IF;
  IF NOT (private.is_admin(_uid) OR private.is_company_owner(_uid, _co)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  UPDATE public.jobs SET needs_review = false WHERE id = _job_id;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_job_reviewed(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_job_reviewed(uuid) TO authenticated;