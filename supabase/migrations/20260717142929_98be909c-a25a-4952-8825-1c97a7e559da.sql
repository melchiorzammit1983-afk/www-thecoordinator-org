
-- Client-side payment metadata (coordinator/admin marks that the client paid)
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS paid_amount numeric(10,2),
  ADD COLUMN IF NOT EXISTS paid_method text,
  ADD COLUMN IF NOT EXISTS paid_reference text,
  ADD COLUMN IF NOT EXISTS paid_by_user_id uuid,
  ADD COLUMN IF NOT EXISTS paid_by_role text;

-- Driver-side payout receipt (driver marks that they got paid)
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS driver_paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS driver_paid_amount numeric(10,2),
  ADD COLUMN IF NOT EXISTS driver_paid_method text,
  ADD COLUMN IF NOT EXISTS driver_paid_reference text,
  ADD COLUMN IF NOT EXISTS driver_paid_by_user_id uuid,
  ADD COLUMN IF NOT EXISTS driver_payout_status text NOT NULL DEFAULT 'pending';

-- Method whitelist (enforced in application; keep DB permissive for admin edits)
COMMENT ON COLUMN public.jobs.paid_method IS 'cash | bank_transfer | card | other';
COMMENT ON COLUMN public.jobs.driver_paid_method IS 'cash | bank_transfer | card | other';
COMMENT ON COLUMN public.jobs.driver_payout_status IS 'pending | partial | paid';

CREATE INDEX IF NOT EXISTS jobs_paid_at_idx ON public.jobs(paid_at);
CREATE INDEX IF NOT EXISTS jobs_driver_paid_at_idx ON public.jobs(driver_paid_at);

-- Keep payment_status in sync with paid_amount vs price_amount.
CREATE OR REPLACE FUNCTION public.sync_job_payment_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  _price numeric(10,2) := COALESCE(NEW.price_amount, 0);
  _paid  numeric(10,2) := COALESCE(NEW.paid_amount, 0);
BEGIN
  IF _paid <= 0 THEN
    NEW.payment_status := 'pending';
  ELSIF _price > 0 AND _paid < _price THEN
    NEW.payment_status := 'partial';
  ELSE
    NEW.payment_status := 'paid';
  END IF;

  IF NEW.driver_paid_amount IS NULL OR NEW.driver_paid_amount <= 0 THEN
    NEW.driver_payout_status := 'pending';
  ELSIF _price > 0 AND NEW.driver_paid_amount < _price THEN
    NEW.driver_payout_status := 'partial';
  ELSE
    NEW.driver_payout_status := 'paid';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS jobs_sync_payment_status ON public.jobs;
CREATE TRIGGER jobs_sync_payment_status
  BEFORE INSERT OR UPDATE OF paid_amount, driver_paid_amount, price_amount ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.sync_job_payment_status();

-- Security-definer helper: driver marks their own payout received.
CREATE OR REPLACE FUNCTION public.driver_mark_payout(
  _job_id uuid,
  _amount numeric,
  _method text,
  _reference text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _driver_owner uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF _method IS NOT NULL AND _method NOT IN ('cash','bank_transfer','card','other') THEN
    RAISE EXCEPTION 'invalid_method';
  END IF;
  SELECT d.linked_user_id INTO _driver_owner
    FROM public.jobs j
    JOIN public.drivers d ON d.id = j.driver_id
    WHERE j.id = _job_id;
  IF _driver_owner IS NULL OR _driver_owner <> _uid THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  UPDATE public.jobs
    SET driver_paid_at = COALESCE(driver_paid_at, now()),
        driver_paid_amount = _amount,
        driver_paid_method = _method,
        driver_paid_reference = _reference,
        driver_paid_by_user_id = _uid
    WHERE id = _job_id;
END;
$$;

REVOKE ALL ON FUNCTION public.driver_mark_payout(uuid, numeric, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.driver_mark_payout(uuid, numeric, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.driver_clear_payout(_job_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _driver_owner uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT d.linked_user_id INTO _driver_owner
    FROM public.jobs j JOIN public.drivers d ON d.id = j.driver_id
    WHERE j.id = _job_id;
  IF _driver_owner IS NULL OR _driver_owner <> _uid THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  UPDATE public.jobs
    SET driver_paid_at = NULL,
        driver_paid_amount = NULL,
        driver_paid_method = NULL,
        driver_paid_reference = NULL,
        driver_paid_by_user_id = NULL
    WHERE id = _job_id;
END;
$$;

REVOKE ALL ON FUNCTION public.driver_clear_payout(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.driver_clear_payout(uuid) TO authenticated;
