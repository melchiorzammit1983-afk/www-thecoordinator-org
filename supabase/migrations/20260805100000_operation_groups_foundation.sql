-- Milestone 22 / Stage 1: additive Operation Group foundation.
-- Existing operations, jobs, trips, and historical records remain unchanged.

CREATE TABLE public.operation_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  reference text NOT NULL CHECK (char_length(btrim(reference)) BETWEEN 1 AND 120),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
  type text NOT NULL CHECK (type IN (
    'crew_change', 'conference', 'event', 'charter',
    'hotel_operation', 'airport_operation', 'vip_movement', 'other'
  )),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'completed', 'cancelled')),
  start_date date,
  end_date date,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);

CREATE UNIQUE INDEX operation_groups_company_reference_unique
  ON public.operation_groups (company_id, lower(btrim(reference)));
CREATE INDEX operation_groups_company_status_idx
  ON public.operation_groups (company_id, status);

DROP TRIGGER IF EXISTS trg_operation_groups_touch_updated_at ON public.operation_groups;
CREATE TRIGGER trg_operation_groups_touch_updated_at
  BEFORE UPDATE ON public.operation_groups
  FOR EACH ROW EXECUTE FUNCTION public.touch_transport_updated_at();

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS operation_group_id uuid
    REFERENCES public.operation_groups(id) ON DELETE RESTRICT;

ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS operation_group_id uuid
    REFERENCES public.operation_groups(id) ON DELETE RESTRICT;

CREATE INDEX jobs_operation_group_id_idx
  ON public.jobs (operation_group_id)
  WHERE operation_group_id IS NOT NULL;
CREATE INDEX trips_operation_group_id_idx
  ON public.trips (operation_group_id)
  WHERE operation_group_id IS NOT NULL;

CREATE TABLE public.operation_group_ship_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_group_id uuid NOT NULL REFERENCES public.operation_groups(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  ship_event_id uuid NOT NULL REFERENCES public.ship_events(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (operation_group_id, ship_event_id)
);

CREATE INDEX operation_group_ship_events_company_idx
  ON public.operation_group_ship_events (company_id);
CREATE INDEX operation_group_ship_events_ship_event_idx
  ON public.operation_group_ship_events (ship_event_id);

CREATE TABLE public.operation_group_flight_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_group_id uuid NOT NULL REFERENCES public.operation_groups(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  flight_schedule_record_id uuid NOT NULL REFERENCES public.flight_schedule_records(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (operation_group_id, flight_schedule_record_id)
);

CREATE INDEX operation_group_flight_records_company_idx
  ON public.operation_group_flight_records (company_id);
CREATE INDEX operation_group_flight_records_flight_idx
  ON public.operation_group_flight_records (flight_schedule_record_id);

-- Keep Jobs authoritative. Trips receive only the explicit group selected on Jobs;
-- existing rows remain NULL and no grouping is inferred.
CREATE OR REPLACE FUNCTION public.mirror_job_operation_group()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  UPDATE public.trips
     SET operation_group_id = NEW.operation_group_id,
         updated_at = now()
   WHERE legacy_job_id = NEW.id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_jobs_transport_core_zz_operation_group ON public.jobs;
CREATE TRIGGER trg_jobs_transport_core_zz_operation_group
  AFTER INSERT OR UPDATE OF operation_group_id ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.mirror_job_operation_group();

-- Relationship writes must use the group company and the company-owned Ship.
CREATE OR REPLACE FUNCTION public.validate_operation_group_relationship_company()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  group_company uuid;
  ship_company uuid;
BEGIN
  SELECT company_id INTO group_company
    FROM public.operation_groups
   WHERE id = NEW.operation_group_id;
  IF group_company IS NULL OR group_company <> NEW.company_id THEN
    RAISE EXCEPTION 'Operation Group company does not match relationship company';
  END IF;

  IF TG_TABLE_NAME = 'operation_group_ship_events' THEN
    SELECT company_id INTO ship_company
      FROM public.ship_events
     WHERE id = NEW.ship_event_id;
    IF ship_company IS NULL OR ship_company <> NEW.company_id THEN
      RAISE EXCEPTION 'Ship Event belongs to another company';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_operation_group_ship_events_company ON public.operation_group_ship_events;
CREATE TRIGGER trg_operation_group_ship_events_company
  BEFORE INSERT OR UPDATE ON public.operation_group_ship_events
  FOR EACH ROW EXECUTE FUNCTION public.validate_operation_group_relationship_company();

-- Flight schedules are shared reference data, so only the group/company match is
-- enforced here; schedule ownership does not exist in the current architecture.
DROP TRIGGER IF EXISTS trg_operation_group_flight_records_company ON public.operation_group_flight_records;
CREATE TRIGGER trg_operation_group_flight_records_company
  BEFORE INSERT OR UPDATE ON public.operation_group_flight_records
  FOR EACH ROW EXECUTE FUNCTION public.validate_operation_group_relationship_company();

ALTER TABLE public.operation_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operation_group_ship_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operation_group_flight_records ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'operation_groups' AND policyname = 'Company owners manage operation groups') THEN
    CREATE POLICY "Company owners manage operation groups"
      ON public.operation_groups FOR ALL TO authenticated
      USING (public.is_company_owner(auth.uid(), company_id) OR public.is_admin(auth.uid()))
      WITH CHECK (public.is_company_owner(auth.uid(), company_id) OR public.is_admin(auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'operation_group_ship_events' AND policyname = 'Company owners manage operation group ships') THEN
    CREATE POLICY "Company owners manage operation group ships"
      ON public.operation_group_ship_events FOR ALL TO authenticated
      USING (EXISTS (SELECT 1 FROM public.operation_groups g WHERE g.id = operation_group_id AND (public.is_company_owner(auth.uid(), g.company_id) OR public.is_admin(auth.uid()))))
      WITH CHECK (EXISTS (SELECT 1 FROM public.operation_groups g WHERE g.id = operation_group_id AND (public.is_company_owner(auth.uid(), g.company_id) OR public.is_admin(auth.uid()))));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'operation_group_flight_records' AND policyname = 'Company owners manage operation group flights') THEN
    CREATE POLICY "Company owners manage operation group flights"
      ON public.operation_group_flight_records FOR ALL TO authenticated
      USING (EXISTS (SELECT 1 FROM public.operation_groups g WHERE g.id = operation_group_id AND (public.is_company_owner(auth.uid(), g.company_id) OR public.is_admin(auth.uid()))))
      WITH CHECK (EXISTS (SELECT 1 FROM public.operation_groups g WHERE g.id = operation_group_id AND (public.is_company_owner(auth.uid(), g.company_id) OR public.is_admin(auth.uid()))));
  END IF;
END
$$;
