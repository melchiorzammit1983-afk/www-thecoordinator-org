
-- Per-company trip counters (internal only)
CREATE TABLE IF NOT EXISTS public.company_trip_counters (
  company_id uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  last_no int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.company_trip_counters TO service_role;
ALTER TABLE public.company_trip_counters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "counters no client access"
  ON public.company_trip_counters FOR SELECT TO authenticated USING (false);

-- Trip number column
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS trip_no int;
CREATE UNIQUE INDEX IF NOT EXISTS jobs_company_trip_no_uk
  ON public.jobs(company_id, trip_no) WHERE trip_no IS NOT NULL;

-- Trigger to assign next per-company number on insert
CREATE OR REPLACE FUNCTION public.assign_job_trip_no()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_no int;
BEGIN
  IF NEW.trip_no IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.company_id IS NULL THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.company_trip_counters (company_id, last_no)
    VALUES (NEW.company_id, 1)
  ON CONFLICT (company_id) DO UPDATE
    SET last_no = public.company_trip_counters.last_no + 1,
        updated_at = now()
  RETURNING last_no INTO next_no;
  NEW.trip_no := next_no;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_job_trip_no ON public.jobs;
CREATE TRIGGER trg_assign_job_trip_no
  BEFORE INSERT ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.assign_job_trip_no();

-- Backfill existing rows per company in creation order
DO $$
DECLARE
  cid uuid;
  r RECORD;
  n int;
BEGIN
  FOR cid IN SELECT DISTINCT company_id FROM public.jobs WHERE company_id IS NOT NULL LOOP
    n := 0;
    FOR r IN
      SELECT id FROM public.jobs
       WHERE company_id = cid AND trip_no IS NULL
       ORDER BY created_at ASC, id ASC
    LOOP
      n := n + 1;
      UPDATE public.jobs SET trip_no = n WHERE id = r.id;
    END LOOP;
    IF n > 0 THEN
      INSERT INTO public.company_trip_counters (company_id, last_no)
        VALUES (cid, n)
      ON CONFLICT (company_id) DO UPDATE
        SET last_no = GREATEST(public.company_trip_counters.last_no, EXCLUDED.last_no),
            updated_at = now();
    END IF;
  END LOOP;
END $$;
