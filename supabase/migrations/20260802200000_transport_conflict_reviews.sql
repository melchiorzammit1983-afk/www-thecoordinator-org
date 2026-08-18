-- The conflict is calculated from current operational data. This table stores
-- only the immutable coordinator review audit for an explicitly linked trip.
CREATE TABLE public.transport_conflict_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL UNIQUE REFERENCES public.jobs(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX transport_conflict_reviews_company_reviewed_idx
  ON public.transport_conflict_reviews (company_id, reviewed_at DESC);

ALTER TABLE public.transport_conflict_reviews ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.transport_conflict_reviews TO service_role;
REVOKE ALL ON public.transport_conflict_reviews FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.prevent_transport_conflict_review_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'Transport conflict review records are immutable';
END;
$$;

CREATE TRIGGER transport_conflict_reviews_immutable
  BEFORE UPDATE OR DELETE ON public.transport_conflict_reviews
  FOR EACH ROW EXECUTE FUNCTION public.prevent_transport_conflict_review_mutation();
