
-- 1. New rollup column on jobs
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS event_payout_total_eur numeric(10,2) NOT NULL DEFAULT 0;

-- 2. Authoritative recalculation of totals for a given (job, driver) pair.
CREATE OR REPLACE FUNCTION public.recalc_trip_event_totals(_job_id uuid, _driver_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _job_total numeric(10,2);
  _driver_delta integer;
BEGIN
  IF _job_id IS NOT NULL THEN
    SELECT COALESCE(SUM(payout_delta_eur), 0) INTO _job_total
      FROM public.trip_map_events WHERE job_id = _job_id;
    UPDATE public.jobs
      SET event_payout_total_eur = _job_total
      WHERE id = _job_id;
  END IF;

  IF _driver_id IS NOT NULL THEN
    SELECT COALESCE(SUM(trust_delta), 0) INTO _driver_delta
      FROM public.trip_map_events WHERE driver_id = _driver_id;
    UPDATE public.drivers
      SET trust_score = GREATEST(0, LEAST(200, 100 + _driver_delta)),
          trust_updated_at = now()
      WHERE id = _driver_id;
  END IF;
END;
$$;

-- 3. AFTER-trigger that recomputes on INSERT/UPDATE/DELETE and cascades
-- deletion of any linked auto-created adjustment.
CREATE OR REPLACE FUNCTION public.trip_map_events_recalc_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.adjustment_id IS NOT NULL THEN
      DELETE FROM public.job_adjustments WHERE id = OLD.adjustment_id;
    END IF;
    PERFORM public.recalc_trip_event_totals(OLD.job_id, OLD.driver_id);
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.job_id    IS DISTINCT FROM NEW.job_id
       OR OLD.driver_id IS DISTINCT FROM NEW.driver_id THEN
      PERFORM public.recalc_trip_event_totals(OLD.job_id, OLD.driver_id);
    END IF;
  END IF;

  PERFORM public.recalc_trip_event_totals(NEW.job_id, NEW.driver_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_trip_map_events_recalc ON public.trip_map_events;
CREATE TRIGGER trg_trip_map_events_recalc
AFTER INSERT OR UPDATE OR DELETE ON public.trip_map_events
FOR EACH ROW EXECUTE FUNCTION public.trip_map_events_recalc_trg();

-- 4. Stop the BEFORE-INSERT impact trigger from bumping trust directly —
-- the AFTER trigger is now authoritative. Adjustment/impact assignment stays.
CREATE OR REPLACE FUNCTION public.apply_trip_event_impact()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _payout numeric(10,2) := 0;
  _trust  integer := 0;
  _kind   text := NULL;
  _label  text := NULL;
  _amount numeric(10,2);
  _adj_id uuid := NULL;
  _wait_session uuid := NULL;
BEGIN
  CASE NEW.event_type
    WHEN 'wait_ended' THEN
      BEGIN
        _amount := COALESCE(
          NULLIF((NEW.meta->>'agreed_amount')::numeric, 0),
          (NEW.meta->>'calculated_amount')::numeric,
          0
        );
      EXCEPTION WHEN OTHERS THEN _amount := 0; END;
      IF _amount > 0 THEN
        _payout := _amount;
        _kind   := 'wait';
        _label  := 'Waiting charge (auto)';
        BEGIN
          _wait_session := NULLIF(NEW.meta->>'wait_session_id','')::uuid;
        EXCEPTION WHEN OTHERS THEN _wait_session := NULL; END;
      END IF;
    WHEN 'pax_no_show' THEN
      _payout := 10.00; _kind := 'no_show';
      _label  := 'Passenger no-show fee';
      _trust  := 1;
    WHEN 'pax_cancelled' THEN
      _payout := 5.00;  _kind := 'cancellation';
      _label  := 'Passenger cancellation fee';
    WHEN 'completed' THEN
      _trust := 2;
    WHEN 'arrived_pickup_override' THEN
      _trust := -5;
    WHEN 'status_corrected' THEN
      _trust := -3;
    WHEN 'boarding_rejected' THEN
      _trust := -2;
    WHEN 'emergency_override' THEN
      _trust := -1;
    WHEN 'safety_concern' THEN
      _trust := -1;
    WHEN 'breakdown' THEN
      _trust := -1;
    ELSE NULL;
  END CASE;

  IF _payout > 0 AND _kind = 'wait' AND _wait_session IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.job_adjustments WHERE wait_session_id = _wait_session) THEN
      _payout := 0; _kind := NULL;
    END IF;
  END IF;
  IF _payout > 0 AND _kind IN ('no_show','cancellation') THEN
    IF EXISTS (SELECT 1 FROM public.job_adjustments WHERE job_id = NEW.job_id AND kind = _kind) THEN
      _payout := 0; _kind := NULL;
    END IF;
  END IF;

  IF _payout > 0 AND _kind IS NOT NULL AND NEW.driver_id IS NOT NULL THEN
    BEGIN
      INSERT INTO public.job_adjustments (
        job_id, driver_id, company_id, kind, label, amount, currency,
        wait_session_id, source, driver_note
      ) VALUES (
        NEW.job_id, NEW.driver_id, NEW.company_id, _kind, _label, _payout, 'EUR',
        _wait_session, 'trip_event:' || NEW.event_type, NEW.notes
      ) RETURNING id INTO _adj_id;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'apply_trip_event_impact: adjustment insert failed: %', SQLERRM;
    END;
  END IF;

  -- Trust score is now maintained by trip_map_events_recalc_trg.
  NEW.payout_delta_eur := COALESCE(_payout, 0);
  NEW.trust_delta      := COALESCE(_trust, 0);
  NEW.adjustment_id    := _adj_id;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'apply_trip_event_impact failed: %', SQLERRM;
  RETURN NEW;
END;
$function$;

-- 5. Backfill totals from existing events.
UPDATE public.jobs j
  SET event_payout_total_eur = COALESCE(t.total, 0)
  FROM (
    SELECT job_id, SUM(payout_delta_eur) AS total
    FROM public.trip_map_events
    GROUP BY job_id
  ) t
  WHERE t.job_id = j.id;

UPDATE public.drivers d
  SET trust_score = GREATEST(0, LEAST(200, 100 + COALESCE(t.delta, 0))),
      trust_updated_at = now()
  FROM (
    SELECT driver_id, SUM(trust_delta) AS delta
    FROM public.trip_map_events
    WHERE driver_id IS NOT NULL
    GROUP BY driver_id
  ) t
  WHERE t.driver_id = d.id;
