-- Import sessions extend the existing M1 import table. They are append-only
-- audit records for one submitted, validated source file.
ALTER TABLE public.flight_schedule_imports
  ADD COLUMN source_type text NOT NULL DEFAULT 'spreadsheet'
    CHECK (source_type IN ('spreadsheet')),
  ADD COLUMN total_rows integer NOT NULL DEFAULT 0 CHECK (total_rows >= 0),
  ADD COLUMN valid_rows integer NOT NULL DEFAULT 0 CHECK (valid_rows >= 0),
  ADD COLUMN warning_rows integer NOT NULL DEFAULT 0 CHECK (warning_rows >= 0),
  ADD COLUMN error_rows integer NOT NULL DEFAULT 0 CHECK (error_rows >= 0),
  ADD COLUMN validation_status text NOT NULL DEFAULT 'pending'
    CHECK (validation_status IN ('pending', 'valid', 'warning', 'error'));

-- Stored schedule rows are reference data only. They are never associated
-- with any company, passenger, driver, trip, or customer record.
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

CREATE INDEX flight_schedule_records_version_idx
  ON public.flight_schedule_records (schedule_version_id, scheduled_date, scheduled_time);
CREATE INDEX flight_schedule_records_import_session_idx
  ON public.flight_schedule_records (import_session_id);

ALTER TABLE public.flight_schedule_records ENABLE ROW LEVEL SECURITY;

-- Imported session and row data is immutable. Version status remains mutable
-- for the separately approved activation milestone.
CREATE FUNCTION public.prevent_flight_schedule_import_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
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

-- One database transaction creates the audit session, immutable draft version,
-- and every linked source row. It is only callable by the server service role;
-- the application performs its existing assertAdmin check before invoking it.
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

  SELECT
    min((record.value->>'date')::date),
    max((record.value->>'date')::date)
  INTO v_coverage_start, v_coverage_end
  FROM jsonb_array_elements(p_records) AS record(value);

  INSERT INTO public.flight_schedule_versions (
    name,
    status,
    coverage_start,
    coverage_end,
    created_by
  )
  VALUES (
    concat('Draft - ', p_source_filename, ' - ', to_char(now(), 'YYYY-MM-DD HH24:MI')),
    'draft',
    v_coverage_start,
    v_coverage_end,
    p_created_by
  )
  RETURNING id INTO v_version_id;

  INSERT INTO public.flight_schedule_imports (
    schedule_version_id,
    source_filename,
    source_type,
    status,
    summary,
    total_rows,
    valid_rows,
    warning_rows,
    error_rows,
    validation_status,
    created_by
  )
  VALUES (
    v_version_id,
    p_source_filename,
    p_source_type,
    'imported',
    p_summary,
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
    schedule_version_id,
    import_session_id,
    source_row_number,
    scheduled_date,
    direction,
    airline,
    flight_number,
    scheduled_time,
    origin,
    destination,
    aircraft_type
  )
  SELECT
    v_version_id,
    v_import_id,
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
