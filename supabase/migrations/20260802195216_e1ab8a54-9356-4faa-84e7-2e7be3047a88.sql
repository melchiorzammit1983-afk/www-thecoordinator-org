CREATE OR REPLACE FUNCTION public.ensure_pax_operation_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.operation_id IS NULL AND NEW.job_id IS NOT NULL THEN
    SELECT j.operation_id INTO NEW.operation_id FROM public.jobs j WHERE j.id = NEW.job_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pax_ensure_operation_id ON public.pax;
CREATE TRIGGER trg_pax_ensure_operation_id
BEFORE INSERT OR UPDATE ON public.pax
FOR EACH ROW EXECUTE FUNCTION public.ensure_pax_operation_id();

REVOKE EXECUTE ON FUNCTION public.ensure_pax_operation_id() FROM PUBLIC, anon, authenticated;