CREATE TABLE public.flight_schedule_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  effective_from date,
  coverage_start date,
  coverage_end date,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  activated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  activated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (coverage_end IS NULL OR coverage_start IS NULL OR coverage_end >= coverage_start)
);
GRANT ALL ON public.flight_schedule_versions TO service_role;
ALTER TABLE public.flight_schedule_versions ENABLE ROW LEVEL SECURITY;
-- No client policies by design: all access goes through admin-guarded server functions.

CREATE UNIQUE INDEX flight_schedule_versions_one_active_idx
  ON public.flight_schedule_versions ((status)) WHERE status = 'active';

CREATE TABLE public.flight_schedule_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_version_id uuid REFERENCES public.flight_schedule_versions(id) ON DELETE SET NULL,
  source_filename text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'validated', 'imported', 'failed')),
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_type text NOT NULL DEFAULT 'spreadsheet' CHECK (source_type IN ('spreadsheet')),
  total_rows integer NOT NULL DEFAULT 0 CHECK (total_rows >= 0),
  valid_rows integer NOT NULL DEFAULT 0 CHECK (valid_rows >= 0),
  warning_rows integer NOT NULL DEFAULT 0 CHECK (warning_rows >= 0),
  error_rows integer NOT NULL DEFAULT 0 CHECK (error_rows >= 0),
  validation_status text NOT NULL DEFAULT 'pending' CHECK (validation_status IN ('pending', 'valid', 'warning', 'error')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.flight_schedule_imports TO service_role;
ALTER TABLE public.flight_schedule_imports ENABLE ROW LEVEL SECURITY;

CREATE INDEX flight_schedule_imports_created_at_idx ON public.flight_schedule_imports (created_at DESC);

CREATE TABLE public.flight_schedule_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_version_id uuid NOT NULL REFERENCES public.flight_schedule_versions(id) ON DELETE RESTRICT,
  import_session_id uuid NOT NULL REFERENCES public.flight_schedule_imports(id) ON DELETE RESTRICT,
  source_row_number integer NOT NULL CHECK (source_row_number > 0),
  scheduled_date date NOT NULL,
  direction text NOT NULL CHECK (direction IN ('arrival', 'departure')),
  airline text NOT NULL CHECK (char_length(airline) BETWEEN 1 AND 200),
  flight_number text NOT NULL CHECK (char_length(flight_number) BETWEEN 1 AND 20),
  scheduled_time time NOT NULL,
  origin char(3) NOT NULL CHECK (origin = upper(origin)),
  destination char(3) NOT NULL CHECK (destination = upper(destination)),
  aircraft_type text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (schedule_version_id, flight_number, scheduled_date, direction, scheduled_time)
);
GRANT ALL ON public.flight_schedule_records TO service_role;
ALTER TABLE public.flight_schedule_records ENABLE ROW LEVEL SECURITY;

CREATE INDEX flight_schedule_records_version_idx
  ON public.flight_schedule_records (schedule_version_id, scheduled_date, scheduled_time);
CREATE INDEX flight_schedule_records_import_session_idx
  ON public.flight_schedule_records (import_session_id);

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS flight_schedule_record_id uuid
    REFERENCES public.flight_schedule_records(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS jobs_flight_schedule_record_id_idx
  ON public.jobs (flight_schedule_record_id)
  WHERE flight_schedule_record_id IS NOT NULL;

CREATE FUNCTION public.prevent_flight_schedule_import_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'Flight schedule import sessions and records are immutable';
END;
$$;

CREATE TRIGGER flight_schedule_imports_immutable
  BEFORE UPDATE OR DELETE ON public.flight_schedule_imports
  FOR EACH ROW EXECUTE FUNCTION public.prevent_flight_schedule_import_mutation();

CREATE TRIGGER flight_schedule_records_immutable
  BEFORE UPDATE OR DELETE ON public.flight_schedule_records
  FOR EACH ROW EXECUTE FUNCTION public.prevent_flight_schedule_import_mutation();

CREATE FUNCTION public.create_flight_schedule_draft(
  p_source_filename text,
  p_source_type text,
  p_created_by uuid,
  p_summary jsonb,
  p_records jsonb
)
RETURNS TABLE (import_session_id uuid, schedule_version_id uuid)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_import_id uuid;
  v_version_id uuid;
  v_coverage_start date;
  v_coverage_end date;
BEGIN
  IF jsonb_typeof(p_records) <> 'array' OR jsonb_array_length(p_records) = 0 THEN
    RAISE EXCEPTION 'A draft schedule requires at least one flight record';
  END IF;

  SELECT min((record.value->>'date')::date), max((record.value->>'date')::date)
  INTO v_coverage_start, v_coverage_end
  FROM jsonb_array_elements(p_records) AS record(value);

  INSERT INTO public.flight_schedule_versions (name, status, coverage_start, coverage_end, created_by)
  VALUES (
    concat('Draft - ', p_source_filename, ' - ', to_char(now(), 'YYYY-MM-DD HH24:MI')),
    'draft', v_coverage_start, v_coverage_end, p_created_by
  )
  RETURNING id INTO v_version_id;

  INSERT INTO public.flight_schedule_imports (
    schedule_version_id, source_filename, source_type, status, summary,
    total_rows, valid_rows, warning_rows, error_rows, validation_status, created_by
  )
  VALUES (
    v_version_id, p_source_filename, p_source_type, 'imported', p_summary,
    COALESCE((p_summary->>'totalRows')::integer, 0),
    COALESCE((p_summary->>'validRows')::integer, 0),
    COALESCE((p_summary->>'warningRows')::integer, 0),
    COALESCE((p_summary->>'errorRows')::integer, 0),
    CASE
      WHEN COALESCE((p_summary->>'errorRows')::integer, 0) > 0 THEN 'error'
      WHEN COALESCE((p_summary->>'warningRows')::integer, 0) > 0 THEN 'warning'
      ELSE 'valid'
    END,
    p_created_by
  )
  RETURNING id INTO v_import_id;

  INSERT INTO public.flight_schedule_records (
    schedule_version_id, import_session_id, source_row_number, scheduled_date,
    direction, airline, flight_number, scheduled_time, origin, destination, aircraft_type
  )
  SELECT
    v_version_id, v_import_id,
    (record.value->>'rowNumber')::integer,
    (record.value->>'date')::date,
    lower(record.value->>'direction'),
    record.value->>'airline',
    upper(record.value->>'flightNumber'),
    (record.value->>'scheduledTime')::time,
    upper(record.value->>'origin'),
    upper(record.value->>'destination'),
    nullif(record.value->>'aircraftType', '')
  FROM jsonb_array_elements(p_records) AS record(value);

  RETURN QUERY SELECT v_import_id, v_version_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_flight_schedule_draft(text, text, uuid, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_flight_schedule_draft(text, text, uuid, jsonb, jsonb)
  TO service_role;

CREATE FUNCTION public.activate_flight_schedule_draft(
  p_schedule_version_id uuid,
  p_activated_by uuid
)
RETURNS TABLE (schedule_version_id uuid, archived_schedule_version_id uuid)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_schedule_version_id uuid;
  v_archived_schedule_version_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(424242);

  SELECT id INTO v_schedule_version_id
  FROM public.flight_schedule_versions
  WHERE id = p_schedule_version_id AND status = 'draft'
  FOR UPDATE;

  IF v_schedule_version_id IS NULL THEN
    RAISE EXCEPTION 'Only an existing draft schedule can be activated';
  END IF;

  UPDATE public.flight_schedule_versions
  SET status = 'archived', updated_at = now()
  WHERE status = 'active'
  RETURNING id INTO v_archived_schedule_version_id;

  UPDATE public.flight_schedule_versions
  SET status = 'active', activated_by = p_activated_by, activated_at = now(), updated_at = now()
  WHERE id = v_schedule_version_id;

  RETURN QUERY SELECT v_schedule_version_id, v_archived_schedule_version_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.activate_flight_schedule_draft(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_flight_schedule_draft(uuid, uuid)
  TO service_role;