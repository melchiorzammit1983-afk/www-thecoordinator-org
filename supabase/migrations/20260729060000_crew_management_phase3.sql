-- Crew Management System — Phase 3: auto-trip creation + coordinator confirmation

-- Itinerary legs need an arrival TIME (arrival_date already existed since Phase 1)
-- so the Malta-landing leg carries a real pickup timestamp for trip creation.
ALTER TABLE public.crew_itineraries ADD COLUMN IF NOT EXISTS arrival_time TIME;

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS auto_created_from_crew_itinerary BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS crew_itinerary_ids UUID[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS jobs_auto_created_from_crew_idx
  ON public.jobs(company_id) WHERE auto_created_from_crew_itinerary = true;

-- Audit trail of the crew-trip lifecycle: created (auto) -> assigned (driver set)
-- -> pickup_complete (coordinator confirms). One row per transition.
CREATE TABLE public.crew_trip_confirmations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  stage TEXT NOT NULL CHECK (stage IN ('created', 'assigned', 'pickup_complete')),
  confirmed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crew_trip_confirmations TO authenticated;
GRANT ALL ON public.crew_trip_confirmations TO service_role;
ALTER TABLE public.crew_trip_confirmations ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_crew_trip_confirmations_job ON public.crew_trip_confirmations(job_id, confirmed_at DESC);

CREATE POLICY "coordinator can manage own crew trip confirmations"
  ON public.crew_trip_confirmations FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = crew_trip_confirmations.job_id
    AND (private.company_of(auth.uid()) = j.company_id OR private.is_admin(auth.uid()))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = crew_trip_confirmations.job_id
    AND (private.company_of(auth.uid()) = j.company_id OR private.is_admin(auth.uid()))));
