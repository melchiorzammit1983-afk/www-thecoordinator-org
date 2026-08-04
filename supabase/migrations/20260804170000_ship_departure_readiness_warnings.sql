-- Ship Operations 21B: current departure-readiness warnings and immutable audit.
CREATE TABLE public.ship_departure_readiness_warnings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  ship_event_id uuid NOT NULL UNIQUE REFERENCES public.ship_events(id) ON DELETE RESTRICT,
  active boolean NOT NULL DEFAULT true,
  expected_departure timestamptz NOT NULL,
  incomplete_trip_count integer NOT NULL DEFAULT 0 CHECK (incomplete_trip_count >= 0),
  unresolved_status_count integer NOT NULL DEFAULT 0 CHECK (unresolved_status_count >= 0),
  trips_needing_review_count integer NOT NULL DEFAULT 0 CHECK (trips_needing_review_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX ship_departure_readiness_company_active_idx
  ON public.ship_departure_readiness_warnings (company_id, active, expected_departure);

ALTER TABLE public.ship_departure_readiness_warnings ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.ship_departure_readiness_warnings TO service_role;
REVOKE ALL ON public.ship_departure_readiness_warnings FROM PUBLIC, anon, authenticated;

CREATE TABLE public.ship_departure_readiness_warning_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  warning_id uuid NOT NULL REFERENCES public.ship_departure_readiness_warnings(id) ON DELETE RESTRICT,
  ship_event_id uuid NOT NULL REFERENCES public.ship_events(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('created', 'resolved')),
  expected_departure timestamptz NOT NULL,
  incomplete_trip_count integer NOT NULL DEFAULT 0 CHECK (incomplete_trip_count >= 0),
  unresolved_status_count integer NOT NULL DEFAULT 0 CHECK (unresolved_status_count >= 0),
  trips_needing_review_count integer NOT NULL DEFAULT 0 CHECK (trips_needing_review_count >= 0),
  event_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ship_departure_readiness_audit_company_event_idx
  ON public.ship_departure_readiness_warning_audit (company_id, event_at DESC);

ALTER TABLE public.ship_departure_readiness_warning_audit ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.ship_departure_readiness_warning_audit TO service_role;
REVOKE ALL ON public.ship_departure_readiness_warning_audit FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.prevent_ship_departure_readiness_audit_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Ship departure-readiness audit records are immutable';
END;
$$;

CREATE TRIGGER ship_departure_readiness_audit_immutable
  BEFORE UPDATE OR DELETE ON public.ship_departure_readiness_warning_audit
  FOR EACH ROW EXECUTE FUNCTION public.prevent_ship_departure_readiness_audit_mutation();
