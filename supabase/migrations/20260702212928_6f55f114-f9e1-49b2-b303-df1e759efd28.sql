CREATE OR REPLACE FUNCTION public.auto_approve_coordinator_jobs()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.coord_approved_at IS NULL AND (NEW.source IS NULL OR NEW.source NOT LIKE 'client%') THEN
    NEW.coord_approved_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_approve_coord_jobs ON public.jobs;
CREATE TRIGGER trg_auto_approve_coord_jobs
BEFORE INSERT ON public.jobs
FOR EACH ROW EXECUTE FUNCTION public.auto_approve_coordinator_jobs();