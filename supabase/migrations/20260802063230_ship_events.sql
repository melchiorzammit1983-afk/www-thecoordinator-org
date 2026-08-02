-- Manual Ship Operations v1: deliberately private to each company and fully
-- separate from shared Flight Schedule reference data.
CREATE TABLE public.ship_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  ship_name text NOT NULL CHECK (char_length(ship_name) BETWEEN 1 AND 200),
  eta timestamptz NOT NULL,
  port text NOT NULL CHECK (char_length(port) BETWEEN 1 AND 160),
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ship_events_company_eta_idx ON public.ship_events (company_id, eta);

ALTER TABLE public.ship_events ENABLE ROW LEVEL SECURITY;

-- No direct browser policies: authenticated server functions resolve the
-- caller's company and enforce company ownership for every operation.
