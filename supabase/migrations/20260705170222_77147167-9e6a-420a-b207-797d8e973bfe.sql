
-- Partner-coordinator consent for cross-company dispatch.
-- When a coordinator dispatches a trip to another company's driver pool,
-- the receiving coordinator must accept before their driver ever sees it.

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS partner_accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS partner_declined_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS partner_decline_reason TEXT;

-- Backfill: any existing in-house trip (origin/executor same company) is auto-accepted
-- so existing assignments aren't broken. Cross-company trips remain pending until
-- the partner acts.
UPDATE public.jobs
SET partner_accepted_at = COALESCE(partner_accepted_at, created_at, now())
WHERE (executor_company_id IS NULL OR executor_company_id = company_id)
  AND partner_accepted_at IS NULL;

-- Guard: a coordinator cannot set driver_id on a partner-dispatched trip until
-- their company has accepted the dispatch. In-house trips (executor = origin company)
-- are exempt because partner_accepted_at is auto-set above.
CREATE OR REPLACE FUNCTION public.enforce_partner_accept_before_driver_assign()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, private
AS $$
BEGIN
  IF NEW.driver_id IS DISTINCT FROM OLD.driver_id
     AND NEW.driver_id IS NOT NULL
     AND NEW.executor_company_id IS NOT NULL
     AND NEW.executor_company_id IS DISTINCT FROM NEW.company_id
     AND NEW.partner_accepted_at IS NULL THEN
    RAISE EXCEPTION 'partner_must_accept_first';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_partner_accept_before_driver_assign ON public.jobs;
CREATE TRIGGER trg_enforce_partner_accept_before_driver_assign
BEFORE UPDATE ON public.jobs
FOR EACH ROW EXECUTE FUNCTION public.enforce_partner_accept_before_driver_assign();

-- Driver push subscriptions (parallel to client_push_subs).
CREATE TABLE IF NOT EXISTS public.driver_push_subs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_driver_push_subs_driver ON public.driver_push_subs(driver_id);

GRANT ALL ON public.driver_push_subs TO service_role;
-- No anon/authenticated grants: token-scoped server fns use the admin client.

ALTER TABLE public.driver_push_subs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "no_client_access_driver_push_subs" ON public.driver_push_subs
  FOR ALL USING (false) WITH CHECK (false);
