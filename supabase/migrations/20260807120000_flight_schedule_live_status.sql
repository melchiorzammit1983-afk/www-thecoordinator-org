-- One shared live-status row per scheduled flight record. A flight is
-- checked against the live provider at most once per cache window no matter
-- how many trips are linked to it or how many coordinators press refresh —
-- every linked trip reads this single row instead of triggering its own
-- provider request.
CREATE TABLE public.flight_schedule_record_live_status (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flight_schedule_record_id uuid NOT NULL UNIQUE
    REFERENCES public.flight_schedule_records(id) ON DELETE RESTRICT,
  status text,
  note text,
  scheduled_at timestamptz,
  estimated_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.flight_schedule_record_live_status TO service_role;
ALTER TABLE public.flight_schedule_record_live_status ENABLE ROW LEVEL SECURITY;

-- Server functions read/write this via the service-role client only (same
-- as flight_schedule_records); no end-user policies are defined.
