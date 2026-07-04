
ALTER TABLE public.job_price_proposals
  ALTER COLUMN to_company_id DROP NOT NULL,
  ADD COLUMN to_driver_id UUID REFERENCES public.drivers(id) ON DELETE CASCADE;

ALTER TABLE public.job_price_proposals
  ADD CONSTRAINT jpp_to_exactly_one CHECK (
    (to_company_id IS NOT NULL AND to_driver_id IS NULL)
    OR (to_company_id IS NULL AND to_driver_id IS NOT NULL)
  );

CREATE INDEX idx_jpp_to_driver ON public.job_price_proposals (to_driver_id, status);
