
DO $$ BEGIN
  CREATE TYPE public.dispatch_hop_status AS ENUM ('pending','accepted','rejected','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS dispatch_chain_company_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[];

CREATE INDEX IF NOT EXISTS jobs_dispatch_chain_gin
  ON public.jobs USING gin (dispatch_chain_company_ids);

UPDATE public.jobs
   SET dispatch_chain_company_ids =
       ARRAY(SELECT DISTINCT x FROM unnest(ARRAY[
         COALESCE(origin_company_id, company_id),
         COALESCE(executor_company_id, company_id),
         company_id
       ]) AS x WHERE x IS NOT NULL)
 WHERE dispatch_chain_company_ids = ARRAY[]::uuid[];

CREATE TABLE IF NOT EXISTS public.job_dispatch_hops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  hop_index int NOT NULL,
  from_company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  to_company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  status public.dispatch_hop_status NOT NULL DEFAULT 'pending',
  note text,
  dispatched_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, hop_index)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_dispatch_hops TO authenticated;
GRANT ALL ON public.job_dispatch_hops TO service_role;
ALTER TABLE public.job_dispatch_hops ENABLE ROW LEVEL SECURITY;

INSERT INTO public.job_dispatch_hops (job_id, hop_index, from_company_id, to_company_id, status, dispatched_at, decided_at)
SELECT j.id, 0, NULL, COALESCE(j.origin_company_id, j.company_id), 'accepted', j.created_at, j.created_at
FROM public.jobs j
LEFT JOIN public.job_dispatch_hops h ON h.job_id = j.id AND h.hop_index = 0
WHERE h.id IS NULL AND COALESCE(j.origin_company_id, j.company_id) IS NOT NULL;

INSERT INTO public.job_dispatch_hops (job_id, hop_index, from_company_id, to_company_id, status, note, dispatched_at, decided_at)
SELECT j.id, 1, j.origin_company_id, j.executor_company_id,
       COALESCE(j.dispatch_status::text, 'accepted')::public.dispatch_hop_status,
       j.dispatch_note, COALESCE(j.dispatched_at, j.created_at), j.dispatch_decided_at
FROM public.jobs j
LEFT JOIN public.job_dispatch_hops h ON h.job_id = j.id AND h.hop_index = 1
WHERE h.id IS NULL
  AND j.executor_company_id IS NOT NULL
  AND j.origin_company_id IS NOT NULL
  AND j.executor_company_id <> j.origin_company_id;

CREATE OR REPLACE FUNCTION public.job_in_my_chain(_job_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.jobs j
    WHERE j.id = _job_id
      AND public.company_of(auth.uid()) = ANY(j.dispatch_chain_company_ids)
  );
$$;

DROP POLICY IF EXISTS "hops_select_chain" ON public.job_dispatch_hops;
CREATE POLICY "hops_select_chain" ON public.job_dispatch_hops
  FOR SELECT TO authenticated
  USING (public.job_in_my_chain(job_id));

DROP POLICY IF EXISTS "hops_insert_executor" ON public.job_dispatch_hops;
CREATE POLICY "hops_insert_executor" ON public.job_dispatch_hops
  FOR INSERT TO authenticated
  WITH CHECK (from_company_id = public.company_of(auth.uid()));

DROP POLICY IF EXISTS "hops_update_participant" ON public.job_dispatch_hops;
CREATE POLICY "hops_update_participant" ON public.job_dispatch_hops
  FOR UPDATE TO authenticated
  USING (to_company_id = public.company_of(auth.uid())
         OR from_company_id = public.company_of(auth.uid()));

DROP POLICY IF EXISTS "jobs_select_chain" ON public.jobs;
CREATE POLICY "jobs_select_chain" ON public.jobs
  FOR SELECT TO authenticated
  USING (public.company_of(auth.uid()) = ANY(dispatch_chain_company_ids));

DROP POLICY IF EXISTS "pax_select_chain" ON public.pax;
CREATE POLICY "pax_select_chain" ON public.pax
  FOR SELECT TO authenticated
  USING (public.job_in_my_chain(job_id));

DROP POLICY IF EXISTS "tm_select_chain" ON public.trip_messages;
CREATE POLICY "tm_select_chain" ON public.trip_messages
  FOR SELECT TO authenticated
  USING (public.job_in_my_chain(job_id));

CREATE OR REPLACE FUNCTION public.enforce_driver_assign_by_executor()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _me uuid;
BEGIN
  IF NEW.driver_id IS DISTINCT FROM OLD.driver_id THEN
    _me := public.company_of(auth.uid());
    IF _me IS NULL THEN RETURN NEW; END IF;
    IF _me <> COALESCE(NEW.executor_company_id, NEW.company_id) THEN
      RAISE EXCEPTION 'only_current_executor_can_assign_driver';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_enforce_driver_assign ON public.jobs;
CREATE TRIGGER trg_enforce_driver_assign
  BEFORE UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_driver_assign_by_executor();

DROP TRIGGER IF EXISTS trg_hops_updated_at ON public.job_dispatch_hops;
CREATE TRIGGER trg_hops_updated_at
  BEFORE UPDATE ON public.job_dispatch_hops
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.job_dispatch_hops;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL; END $$;

CREATE OR REPLACE FUNCTION public.dispatch_job_forward(_job_id uuid, _to_company uuid, _note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _me uuid; _job record; _next_index int;
BEGIN
  _me := public.company_of(auth.uid());
  IF _me IS NULL THEN RAISE EXCEPTION 'no_company'; END IF;
  SELECT * INTO _job FROM public.jobs WHERE id = _job_id FOR UPDATE;
  IF _job IS NULL THEN RAISE EXCEPTION 'job_not_found'; END IF;
  IF COALESCE(_job.executor_company_id, _job.company_id) <> _me THEN
    RAISE EXCEPTION 'only_current_executor_can_dispatch';
  END IF;
  IF _to_company = _me THEN RAISE EXCEPTION 'cannot_dispatch_to_self'; END IF;
  IF _to_company = ANY(_job.dispatch_chain_company_ids) THEN
    RAISE EXCEPTION 'cycle_detected';
  END IF;
  SELECT COALESCE(MAX(hop_index), -1) + 1 INTO _next_index
    FROM public.job_dispatch_hops WHERE job_id = _job_id;
  INSERT INTO public.job_dispatch_hops(job_id, hop_index, from_company_id, to_company_id, status, note)
  VALUES (_job_id, _next_index, _me, _to_company, 'pending', _note);
  UPDATE public.jobs SET
    origin_company_id = COALESCE(origin_company_id, company_id),
    executor_company_id = _to_company,
    dispatch_status = 'pending',
    dispatched_at = now(),
    dispatch_decided_at = NULL,
    dispatch_note = _note,
    dispatch_chain_company_ids = dispatch_chain_company_ids || _to_company
  WHERE id = _job_id;
END $$;

CREATE OR REPLACE FUNCTION public.respond_dispatch(_job_id uuid, _decision text, _note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _me uuid; _job record; _hop record; _prev uuid;
BEGIN
  _me := public.company_of(auth.uid());
  IF _me IS NULL THEN RAISE EXCEPTION 'no_company'; END IF;
  SELECT * INTO _job FROM public.jobs WHERE id = _job_id FOR UPDATE;
  IF _job IS NULL THEN RAISE EXCEPTION 'job_not_found'; END IF;
  IF _job.executor_company_id <> _me THEN RAISE EXCEPTION 'not_your_pending'; END IF;
  SELECT * INTO _hop FROM public.job_dispatch_hops
    WHERE job_id = _job_id AND to_company_id = _me AND status = 'pending'
    ORDER BY hop_index DESC LIMIT 1;
  IF _hop IS NULL THEN RAISE EXCEPTION 'no_pending_hop'; END IF;
  IF _decision = 'accepted' THEN
    UPDATE public.job_dispatch_hops SET status='accepted', decided_at=now(), note=COALESCE(_note,note)
      WHERE id = _hop.id;
    UPDATE public.jobs SET
      company_id = _me,
      dispatch_status = 'accepted',
      dispatch_decided_at = now(),
      dispatch_note = COALESCE(_note, dispatch_note)
    WHERE id = _job_id;
  ELSIF _decision = 'rejected' THEN
    _prev := _hop.from_company_id;
    UPDATE public.job_dispatch_hops SET status='rejected', decided_at=now(), note=COALESCE(_note,note)
      WHERE id = _hop.id;
    UPDATE public.jobs SET
      executor_company_id = _prev,
      dispatch_status = 'rejected',
      dispatch_decided_at = now(),
      dispatch_note = COALESCE(_note, dispatch_note),
      dispatch_chain_company_ids = array_remove(dispatch_chain_company_ids, _me)
    WHERE id = _job_id;
  ELSE
    RAISE EXCEPTION 'bad_decision';
  END IF;
END $$;
