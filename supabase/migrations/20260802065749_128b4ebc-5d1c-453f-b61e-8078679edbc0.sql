CREATE TABLE IF NOT EXISTS public.ship_events (
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

GRANT ALL ON public.ship_events TO service_role;

CREATE INDEX IF NOT EXISTS ship_events_company_eta_idx ON public.ship_events (company_id, eta);

ALTER TABLE public.ship_events ENABLE ROW LEVEL SECURITY;