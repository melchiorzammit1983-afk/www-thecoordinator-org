-- Operations Centre v1.9: immutable coordinator completion audit for Ship ETA reviews.
CREATE TABLE public.ship_eta_review_completions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  eta_history_id uuid NOT NULL UNIQUE REFERENCES public.ship_event_eta_history(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ship_eta_review_completions_company_reviewed_idx
  ON public.ship_eta_review_completions (company_id, reviewed_at DESC);

ALTER TABLE public.ship_eta_review_completions ENABLE ROW LEVEL SECURITY;

-- Review completions are written and read through authenticated server functions.
GRANT ALL ON public.ship_eta_review_completions TO service_role;
REVOKE ALL ON public.ship_eta_review_completions FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.prevent_ship_eta_review_completion_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'Ship ETA review completion records are immutable';
END;
$$;

CREATE TRIGGER ship_eta_review_completions_immutable
  BEFORE UPDATE OR DELETE ON public.ship_eta_review_completions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_ship_eta_review_completion_mutation();
