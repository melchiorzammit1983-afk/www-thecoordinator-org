
CREATE TABLE public.job_price_proposals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  hop_id UUID REFERENCES public.job_dispatch_hops(id) ON DELETE SET NULL,
  from_party_kind TEXT NOT NULL CHECK (from_party_kind IN ('driver','company')),
  from_company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  from_driver_id UUID REFERENCES public.drivers(id) ON DELETE CASCADE,
  to_company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  amount_eur NUMERIC(10,2) NOT NULL CHECK (amount_eur > 0 AND amount_eur < 100000),
  status TEXT NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed','accepted','countered','recalled','superseded')),
  parent_id UUID REFERENCES public.job_price_proposals(id) ON DELETE SET NULL,
  note TEXT,
  responded_at TIMESTAMPTZ,
  responded_by_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (from_party_kind = 'driver' AND from_driver_id IS NOT NULL AND from_company_id IS NULL)
    OR (from_party_kind = 'company' AND from_company_id IS NOT NULL AND from_driver_id IS NULL)
  )
);

CREATE INDEX idx_jpp_job ON public.job_price_proposals (job_id, status);
CREATE INDEX idx_jpp_to_company ON public.job_price_proposals (to_company_id, status);
CREATE INDEX idx_jpp_from_company ON public.job_price_proposals (from_company_id, status);
CREATE INDEX idx_jpp_from_driver ON public.job_price_proposals (from_driver_id, status);

GRANT SELECT, INSERT, UPDATE ON public.job_price_proposals TO authenticated;
GRANT ALL ON public.job_price_proposals TO service_role;

ALTER TABLE public.job_price_proposals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Parties can view their proposals"
ON public.job_price_proposals FOR SELECT
TO authenticated
USING (
  private.is_admin(auth.uid())
  OR (from_company_id IS NOT NULL AND private.is_company_owner(auth.uid(), from_company_id))
  OR private.is_company_owner(auth.uid(), to_company_id)
);

CREATE POLICY "From-party can create proposals"
ON public.job_price_proposals FOR INSERT
TO authenticated
WITH CHECK (
  private.is_admin(auth.uid())
  OR (from_party_kind = 'company' AND private.is_company_owner(auth.uid(), from_company_id))
);

CREATE POLICY "Parties can update their proposals"
ON public.job_price_proposals FOR UPDATE
TO authenticated
USING (
  private.is_admin(auth.uid())
  OR (from_company_id IS NOT NULL AND private.is_company_owner(auth.uid(), from_company_id))
  OR private.is_company_owner(auth.uid(), to_company_id)
)
WITH CHECK (
  private.is_admin(auth.uid())
  OR (from_company_id IS NOT NULL AND private.is_company_owner(auth.uid(), from_company_id))
  OR private.is_company_owner(auth.uid(), to_company_id)
);

CREATE TRIGGER jpp_set_updated_at
BEFORE UPDATE ON public.job_price_proposals
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
