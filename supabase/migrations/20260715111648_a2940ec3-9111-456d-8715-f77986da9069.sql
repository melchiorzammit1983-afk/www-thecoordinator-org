
-- =====================================================================
-- BATCH C: Audit Trail, Anti-Tampering, Grouped Trip Stops
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------- helper: canonical jsonb (sorted keys, null-stripped) ----------
CREATE OR REPLACE FUNCTION public.canonical_jsonb(_j jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT '{' || string_agg(to_json(k)::text || ':' || public.canonical_jsonb(v), ',' ORDER BY k) || '}'
      FROM jsonb_each(jsonb_strip_nulls(_j)) AS e(k, v)
    ),
    CASE jsonb_typeof(_j)
      WHEN 'array' THEN COALESCE((SELECT '[' || string_agg(public.canonical_jsonb(x), ',') || ']' FROM jsonb_array_elements(_j) AS x), '[]')
      WHEN 'null'  THEN 'null'
      ELSE _j::text
    END
  );
$$;

-- =====================================================================
-- trip_audit_log
-- =====================================================================
CREATE TABLE public.trip_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  group_id uuid,
  stop_id uuid,
  driver_id uuid,
  actor_user_id uuid,
  actor_label text,
  event_type text NOT NULL,
  approval_status text NOT NULL DEFAULT 'not_required',
  previous_state jsonb,
  new_state jsonb,
  notes text,
  gps_lat numeric,
  gps_lng numeric,
  gps_accuracy_m numeric,
  street_address text,
  speed_kmh numeric,
  device_time timestamptz,
  server_time timestamptz NOT NULL DEFAULT now(),
  prev_hash text,
  row_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trip_audit_approval_status_chk CHECK (
    approval_status IN ('approved','rejected','pending','overridden','not_required')
  )
);

CREATE INDEX trip_audit_company_idx  ON public.trip_audit_log(company_id, created_at DESC);
CREATE INDEX trip_audit_job_idx      ON public.trip_audit_log(job_id, created_at);
CREATE INDEX trip_audit_driver_idx   ON public.trip_audit_log(driver_id, created_at DESC);
CREATE INDEX trip_audit_event_idx    ON public.trip_audit_log(event_type, created_at DESC);
CREATE INDEX trip_audit_pending_idx  ON public.trip_audit_log(approval_status)
  WHERE approval_status IN ('pending','rejected');

GRANT SELECT, INSERT ON public.trip_audit_log TO authenticated;
GRANT ALL ON public.trip_audit_log TO service_role;
REVOKE UPDATE, DELETE ON public.trip_audit_log FROM authenticated, anon;

ALTER TABLE public.trip_audit_log ENABLE ROW LEVEL SECURITY;

-- SELECT: admins all, coordinators company-scoped
CREATE POLICY "Admins read all trip audit"
  ON public.trip_audit_log FOR SELECT
  TO authenticated
  USING (private.is_admin(auth.uid()));

CREATE POLICY "Coordinators read own company trip audit"
  ON public.trip_audit_log FOR SELECT
  TO authenticated
  USING (company_id = private.company_of(auth.uid()));

-- INSERT: blocked; use record_trip_audit (SECURITY DEFINER)
CREATE POLICY "Block direct trip audit inserts"
  ON public.trip_audit_log FOR INSERT
  TO authenticated
  WITH CHECK (false);

-- =====================================================================
-- group_stops
-- =====================================================================
CREATE TABLE public.group_stops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  stop_index int NOT NULL,
  address text,
  display_name text,
  place_id text,
  lat numeric,
  lng numeric,
  pax_count int NOT NULL DEFAULT 0,
  arrived_at timestamptz,
  boarded_at timestamptz,
  no_show_at timestamptz,
  completed_at timestamptz,
  wait_started_at timestamptz,
  wait_ended_at timestamptz,
  charges_cents int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, stop_index)
);

CREATE INDEX group_stops_group_idx ON public.group_stops(group_id, stop_index);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.group_stops TO authenticated;
GRANT ALL ON public.group_stops TO service_role;

ALTER TABLE public.group_stops ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage group stops"
  ON public.group_stops FOR ALL
  TO authenticated
  USING (private.is_admin(auth.uid()))
  WITH CHECK (private.is_admin(auth.uid()));

CREATE POLICY "Company owners read group stops"
  ON public.group_stops FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.groups g
    JOIN public.jobs j ON j.id = g.job_id
    WHERE g.id = group_stops.group_id
      AND j.company_id = private.company_of(auth.uid())
  ));

CREATE POLICY "Company owners write group stops"
  ON public.group_stops FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.groups g
    JOIN public.jobs j ON j.id = g.job_id
    WHERE g.id = group_stops.group_id
      AND j.company_id = private.company_of(auth.uid())
  ));

CREATE POLICY "Company owners update group stops"
  ON public.group_stops FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.groups g
    JOIN public.jobs j ON j.id = g.job_id
    WHERE g.id = group_stops.group_id
      AND j.company_id = private.company_of(auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.groups g
    JOIN public.jobs j ON j.id = g.job_id
    WHERE g.id = group_stops.group_id
      AND j.company_id = private.company_of(auth.uid())
  ));

CREATE POLICY "Company owners delete group stops"
  ON public.group_stops FOR DELETE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.groups g
    JOIN public.jobs j ON j.id = g.job_id
    WHERE g.id = group_stops.group_id
      AND j.company_id = private.company_of(auth.uid())
  ));

CREATE TRIGGER trg_group_stops_updated_at
  BEFORE UPDATE ON public.group_stops
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =====================================================================
-- group_stop_reorder_requests
-- =====================================================================
CREATE TABLE public.group_stop_reorder_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  requested_by_driver_id uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  proposed_order uuid[] NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected')),
  decided_by_user_id uuid,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX group_stop_reorder_group_idx ON public.group_stop_reorder_requests(group_id, created_at DESC);
CREATE INDEX group_stop_reorder_status_idx ON public.group_stop_reorder_requests(status) WHERE status = 'pending';

GRANT SELECT, INSERT, UPDATE ON public.group_stop_reorder_requests TO authenticated;
GRANT ALL ON public.group_stop_reorder_requests TO service_role;

ALTER TABLE public.group_stop_reorder_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage stop reorder requests"
  ON public.group_stop_reorder_requests FOR ALL
  TO authenticated
  USING (private.is_admin(auth.uid()))
  WITH CHECK (private.is_admin(auth.uid()));

CREATE POLICY "Company owners read stop reorder requests"
  ON public.group_stop_reorder_requests FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.groups g
    JOIN public.jobs j ON j.id = g.job_id
    WHERE g.id = group_stop_reorder_requests.group_id
      AND j.company_id = private.company_of(auth.uid())
  ));

CREATE POLICY "Company owners update stop reorder requests"
  ON public.group_stop_reorder_requests FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.groups g
    JOIN public.jobs j ON j.id = g.job_id
    WHERE g.id = group_stop_reorder_requests.group_id
      AND j.company_id = private.company_of(auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.groups g
    JOIN public.jobs j ON j.id = g.job_id
    WHERE g.id = group_stop_reorder_requests.group_id
      AND j.company_id = private.company_of(auth.uid())
  ));

-- =====================================================================
-- record_trip_audit  (SECURITY DEFINER, only write path)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.record_trip_audit(
  _job_id uuid,
  _event_type text,
  _previous jsonb DEFAULT NULL,
  _new jsonb DEFAULT NULL,
  _notes text DEFAULT NULL,
  _lat numeric DEFAULT NULL,
  _lng numeric DEFAULT NULL,
  _accuracy numeric DEFAULT NULL,
  _address text DEFAULT NULL,
  _speed numeric DEFAULT NULL,
  _device_time timestamptz DEFAULT NULL,
  _group_id uuid DEFAULT NULL,
  _stop_id uuid DEFAULT NULL,
  _approval_status text DEFAULT NULL,
  _driver_id uuid DEFAULT NULL,
  _actor_label text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _company_id uuid;
  _resolved_driver uuid := _driver_id;
  _actor uuid := auth.uid();
  _label text := _actor_label;
  _prev_hash text;
  _canonical text;
  _hash text;
  _payload jsonb;
  _approval text;
  _new_id uuid;
BEGIN
  IF _job_id IS NOT NULL THEN
    SELECT company_id, COALESCE(_resolved_driver, driver_id)
      INTO _company_id, _resolved_driver
      FROM public.jobs WHERE id = _job_id;
  END IF;

  IF _company_id IS NULL AND _group_id IS NOT NULL THEN
    SELECT j.company_id INTO _company_id
      FROM public.groups g JOIN public.jobs j ON j.id = g.job_id
      WHERE g.id = _group_id;
  END IF;

  IF _company_id IS NULL THEN
    RAISE WARNING 'record_trip_audit: cannot resolve company_id for job %', _job_id;
    RETURN NULL;
  END IF;

  -- default approval_status per event class
  _approval := COALESCE(_approval_status,
    CASE
      WHEN _event_type LIKE 'override_%'          THEN 'overridden'
      WHEN _event_type = 'safety_concern'         THEN 'overridden'
      WHEN _event_type = 'breakdown'              THEN 'overridden'
      WHEN _event_type = 'boarding_approved'      THEN 'approved'
      WHEN _event_type = 'stop_reorder_requested' THEN 'pending'
      WHEN _event_type = 'wait_charge_changed'    THEN 'approved'
      ELSE 'not_required'
    END
  );

  IF _label IS NULL THEN
    IF _actor IS NULL THEN _label := 'system';
    ELSIF private.is_admin(_actor) THEN _label := 'admin';
    ELSE _label := 'coordinator';
    END IF;
  END IF;

  -- serialize chain per job
  IF _job_id IS NOT NULL THEN
    SELECT row_hash INTO _prev_hash
      FROM public.trip_audit_log
      WHERE job_id = _job_id
      ORDER BY created_at DESC, id DESC
      LIMIT 1
      FOR UPDATE;
  END IF;

  _payload := jsonb_build_object(
    'company_id',      _company_id,
    'job_id',          _job_id,
    'group_id',        _group_id,
    'stop_id',         _stop_id,
    'driver_id',       _resolved_driver,
    'actor_user_id',   _actor,
    'actor_label',     _label,
    'event_type',      _event_type,
    'approval_status', _approval,
    'previous_state',  _previous,
    'new_state',       _new,
    'notes',           _notes,
    'gps_lat',         _lat,
    'gps_lng',         _lng,
    'gps_accuracy_m',  _accuracy,
    'street_address',  _address,
    'speed_kmh',       _speed,
    'device_time',     _device_time,
    'server_time',     now()
  );

  _canonical := public.canonical_jsonb(_payload);
  _hash := encode(digest(COALESCE(_prev_hash, '') || _canonical, 'sha256'), 'hex');

  INSERT INTO public.trip_audit_log (
    company_id, job_id, group_id, stop_id, driver_id,
    actor_user_id, actor_label, event_type, approval_status,
    previous_state, new_state, notes,
    gps_lat, gps_lng, gps_accuracy_m, street_address, speed_kmh,
    device_time, prev_hash, row_hash
  ) VALUES (
    _company_id, _job_id, _group_id, _stop_id, _resolved_driver,
    _actor, _label, _event_type, _approval,
    _previous, _new, _notes,
    _lat, _lng, _accuracy, _address, _speed,
    _device_time, _prev_hash, _hash
  ) RETURNING id INTO _new_id;

  RETURN _new_id;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'record_trip_audit failed: %', SQLERRM;
  RETURN NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_trip_audit(
  uuid, text, jsonb, jsonb, text, numeric, numeric, numeric, text, numeric,
  timestamptz, uuid, uuid, text, uuid, text
) TO authenticated, anon, service_role;

-- =====================================================================
-- verify_trip_audit_chain
-- =====================================================================
CREATE OR REPLACE FUNCTION public.verify_trip_audit_chain(_job_id uuid)
RETURNS TABLE (row_id uuid, ok boolean, event_type text, created_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _prev text := NULL;
  _rec record;
  _payload jsonb;
  _expected text;
BEGIN
  FOR _rec IN
    SELECT * FROM public.trip_audit_log
    WHERE job_id = _job_id
    ORDER BY created_at ASC, id ASC
  LOOP
    _payload := jsonb_build_object(
      'company_id',      _rec.company_id,
      'job_id',          _rec.job_id,
      'group_id',        _rec.group_id,
      'stop_id',         _rec.stop_id,
      'driver_id',       _rec.driver_id,
      'actor_user_id',   _rec.actor_user_id,
      'actor_label',     _rec.actor_label,
      'event_type',      _rec.event_type,
      'approval_status', _rec.approval_status,
      'previous_state',  _rec.previous_state,
      'new_state',       _rec.new_state,
      'notes',           _rec.notes,
      'gps_lat',         _rec.gps_lat,
      'gps_lng',         _rec.gps_lng,
      'gps_accuracy_m',  _rec.gps_accuracy_m,
      'street_address',  _rec.street_address,
      'speed_kmh',       _rec.speed_kmh,
      'device_time',     _rec.device_time,
      'server_time',     _rec.server_time
    );
    _expected := encode(digest(COALESCE(_prev, '') || public.canonical_jsonb(_payload), 'sha256'), 'hex');
    row_id := _rec.id;
    ok := (_expected = _rec.row_hash) AND (COALESCE(_prev,'') = COALESCE(_rec.prev_hash,''));
    event_type := _rec.event_type;
    created_at := _rec.created_at;
    RETURN NEXT;
    _prev := _rec.row_hash;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_trip_audit_chain(uuid) TO authenticated, service_role;

-- =====================================================================
-- v_suspicious_activity
-- =====================================================================
CREATE OR REPLACE VIEW public.v_suspicious_activity
WITH (security_invoker = true)
AS
WITH windowed AS (
  SELECT
    company_id, driver_id, job_id, event_type, approval_status, created_at
  FROM public.trip_audit_log
  WHERE created_at > now() - interval '7 days'
),
overrides_24h AS (
  SELECT company_id, driver_id, count(*) AS n
  FROM windowed
  WHERE event_type LIKE 'override_%' AND created_at > now() - interval '24 hours'
  GROUP BY 1,2 HAVING count(*) >= 3
),
no_shows_7d AS (
  SELECT company_id, driver_id, count(*) AS n
  FROM windowed
  WHERE event_type = 'pax_no_show'
  GROUP BY 1,2 HAVING count(*) >= 5
),
wait_edits_24h AS (
  SELECT company_id, driver_id, count(*) AS n
  FROM windowed
  WHERE event_type = 'wait_charge_changed' AND created_at > now() - interval '24 hours'
  GROUP BY 1,2 HAVING count(*) >= 3
),
gps_fail_24h AS (
  SELECT company_id, driver_id, count(*) AS n
  FROM windowed
  WHERE event_type = 'arrival_manual' AND created_at > now() - interval '24 hours'
  GROUP BY 1,2 HAVING count(*) >= 2
),
rejected_24h AS (
  SELECT company_id, driver_id, count(*) AS n
  FROM windowed
  WHERE approval_status = 'rejected' AND created_at > now() - interval '24 hours'
  GROUP BY 1,2 HAVING count(*) >= 2
)
SELECT company_id, driver_id, 'excessive_overrides'::text AS signal, n AS count, '24h'::text AS window FROM overrides_24h
UNION ALL
SELECT company_id, driver_id, 'excessive_no_shows',       n, '7d'  FROM no_shows_7d
UNION ALL
SELECT company_id, driver_id, 'excessive_wait_edits',     n, '24h' FROM wait_edits_24h
UNION ALL
SELECT company_id, driver_id, 'gps_validation_failures',  n, '24h' FROM gps_fail_24h
UNION ALL
SELECT company_id, driver_id, 'rejected_actions',         n, '24h' FROM rejected_24h;

GRANT SELECT ON public.v_suspicious_activity TO authenticated, service_role;

-- =====================================================================
-- Write-through triggers (call record_trip_audit; do NOT modify workflow)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.audit_jobs_status_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM public.record_trip_audit(
      NEW.id, 'status_change',
      jsonb_build_object('status', OLD.status),
      jsonb_build_object('status', NEW.status),
      NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
      NEW.driver_id, NULL
    );
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_audit_jobs_status ON public.jobs;
CREATE TRIGGER trg_audit_jobs_status
  AFTER UPDATE OF status ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.audit_jobs_status_trg();

CREATE OR REPLACE FUNCTION public.audit_wait_sessions_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _event text;
BEGIN
  IF TG_OP = 'INSERT' THEN _event := 'wait_started';
  ELSIF NEW.ended_at IS NOT NULL AND OLD.ended_at IS NULL THEN _event := 'wait_ended';
  ELSE RETURN NEW;
  END IF;
  PERFORM public.record_trip_audit(
    NEW.job_id, _event,
    CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) END,
    to_jsonb(NEW),
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    NEW.driver_id, NULL
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_audit_wait_sessions ON public.job_wait_sessions;
CREATE TRIGGER trg_audit_wait_sessions
  AFTER INSERT OR UPDATE ON public.job_wait_sessions
  FOR EACH ROW EXECUTE FUNCTION public.audit_wait_sessions_trg();

CREATE OR REPLACE FUNCTION public.audit_boarding_approvals_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.record_trip_audit(
    NEW.job_id,
    CASE WHEN TG_OP='INSERT' THEN 'boarding_started' ELSE 'boarding_approved' END,
    CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) END,
    to_jsonb(NEW),
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    CASE WHEN TG_OP='INSERT' THEN 'pending' ELSE 'approved' END,
    NULL, NULL
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_audit_boarding_approvals ON public.job_boarding_approvals;
CREATE TRIGGER trg_audit_boarding_approvals
  AFTER INSERT OR UPDATE ON public.job_boarding_approvals
  FOR EACH ROW EXECUTE FUNCTION public.audit_boarding_approvals_trg();

CREATE OR REPLACE FUNCTION public.audit_emergency_overrides_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _event text;
BEGIN
  _event := CASE NEW.reason
    WHEN 'safety_concern' THEN 'safety_concern'
    WHEN 'breakdown'      THEN 'breakdown'
    ELSE 'override_' || COALESCE(NEW.action, 'unknown')
  END;
  PERFORM public.record_trip_audit(
    NEW.job_id, _event,
    NULL, to_jsonb(NEW),
    NEW.notes, NEW.gps_lat, NEW.gps_lng, NEW.gps_accuracy_m,
    NEW.street_address, NULL, NULL, NULL, NULL, 'overridden',
    NEW.driver_id, 'driver'
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_audit_emergency_overrides ON public.job_emergency_overrides;
CREATE TRIGGER trg_audit_emergency_overrides
  AFTER INSERT ON public.job_emergency_overrides
  FOR EACH ROW EXECUTE FUNCTION public.audit_emergency_overrides_trg();

CREATE OR REPLACE FUNCTION public.audit_pax_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _event text; _job uuid;
BEGIN
  IF TG_OP='UPDATE' AND NEW.noshow_at IS NOT NULL AND OLD.noshow_at IS NULL THEN _event := 'pax_no_show';
  ELSIF TG_OP='UPDATE' AND NEW.cancelled_at IS NOT NULL AND OLD.cancelled_at IS NULL THEN _event := 'pax_cancelled';
  ELSE RETURN NEW;
  END IF;
  _job := NEW.job_id;
  PERFORM public.record_trip_audit(
    _job, _event, to_jsonb(OLD), to_jsonb(NEW),
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_audit_pax ON public.pax;
CREATE TRIGGER trg_audit_pax
  AFTER UPDATE ON public.pax
  FOR EACH ROW EXECUTE FUNCTION public.audit_pax_trg();
