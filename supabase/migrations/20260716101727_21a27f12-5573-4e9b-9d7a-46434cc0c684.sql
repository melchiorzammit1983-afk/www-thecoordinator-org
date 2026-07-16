
CREATE TABLE public.trip_map_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  driver_id uuid,
  event_type text NOT NULL CHECK (event_type IN (
    'arrived_pickup','in_progress','completed',
    'pickup_snap','dropoff_snap',
    'actual_dropoff','emergency_override','safety_concern','breakdown'
  )),
  lat numeric(9,6),
  lng numeric(9,6),
  accuracy_m numeric(8,2),
  notes text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX trip_map_events_job_time_idx ON public.trip_map_events (job_id, occurred_at);
CREATE INDEX trip_map_events_company_idx ON public.trip_map_events (company_id);

GRANT SELECT, INSERT ON public.trip_map_events TO authenticated;
GRANT ALL ON public.trip_map_events TO service_role;

ALTER TABLE public.trip_map_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "trip_map_events_read" ON public.trip_map_events
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.id = trip_map_events.job_id
        AND (
          j.company_id = private.company_of(auth.uid())
          OR COALESCE(j.executor_company_id, j.company_id) = private.company_of(auth.uid())
          OR EXISTS (
            SELECT 1 FROM public.drivers d
            WHERE d.id = j.driver_id AND d.linked_user_id = auth.uid()
          )
        )
    )
  );

CREATE POLICY "trip_map_events_driver_insert" ON public.trip_map_events
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.jobs j
      JOIN public.drivers d ON d.id = j.driver_id
      WHERE j.id = trip_map_events.job_id
        AND d.linked_user_id = auth.uid()
    )
  );

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS live_eta_sec integer,
  ADD COLUMN IF NOT EXISTS live_eta_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS live_eta_from_lat numeric(9,6),
  ADD COLUMN IF NOT EXISTS live_eta_from_lng numeric(9,6);

CREATE INDEX IF NOT EXISTS driver_locations_job_time_idx
  ON public.driver_locations (job_id, captured_at);

CREATE OR REPLACE FUNCTION public.log_job_status_map_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _event text;
  _lat numeric;
  _lng numeric;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  _event := CASE NEW.status::text
    WHEN 'arrived' THEN 'arrived_pickup'
    WHEN 'in_progress' THEN 'in_progress'
    WHEN 'completed' THEN 'completed'
    ELSE NULL
  END;

  IF _event IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT dl.latitude, dl.longitude INTO _lat, _lng
    FROM public.driver_locations dl
    WHERE dl.driver_id = NEW.driver_id
    ORDER BY dl.captured_at DESC NULLS LAST
    LIMIT 1;

  IF _event = 'completed' AND _lat IS NOT NULL AND _lng IS NOT NULL THEN
    INSERT INTO public.trip_map_events (job_id, company_id, driver_id, event_type, lat, lng, meta)
    VALUES (
      NEW.id,
      COALESCE(NEW.executor_company_id, NEW.company_id),
      NEW.driver_id,
      'actual_dropoff',
      _lat, _lng,
      jsonb_build_object('planned_lat', NEW.dropoff_lat, 'planned_lng', NEW.dropoff_lng)
    );
  END IF;

  INSERT INTO public.trip_map_events (job_id, company_id, driver_id, event_type, lat, lng)
  VALUES (
    NEW.id,
    COALESCE(NEW.executor_company_id, NEW.company_id),
    NEW.driver_id,
    _event,
    _lat, _lng
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'log_job_status_map_event failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_job_status_map_event ON public.jobs;
CREATE TRIGGER trg_log_job_status_map_event
  AFTER UPDATE OF status ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.log_job_status_map_event();

INSERT INTO public.ai_feature_costs (feature_key, points_cost, enabled, block_on_empty, label, category)
VALUES
  ('live_eta_refresh', 0.1, true, false, 'Live driver ETA refresh', 'routing'),
  ('trip_report_pdf', 2.0, true, false, 'Trip report PDF export', 'reporting')
ON CONFLICT (feature_key) DO NOTHING;
