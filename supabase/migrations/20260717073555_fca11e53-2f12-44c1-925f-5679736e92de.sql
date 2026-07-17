
-- 1) Impact columns on trip_map_events
ALTER TABLE public.trip_map_events
  ADD COLUMN IF NOT EXISTS payout_delta_eur numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS trust_delta integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS adjustment_id uuid REFERENCES public.job_adjustments(id) ON DELETE SET NULL;

-- 2) Driver trust score
ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS trust_score integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS trust_updated_at timestamptz;

-- 3) Impact trigger
CREATE OR REPLACE FUNCTION public.apply_trip_event_impact()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
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
    ELSE
      NULL;
  END CASE;

  -- Skip creating an adjustment if the wait session already has one
  -- (the app's existing wait-charge flow writes one directly).
  IF _payout > 0 AND _kind = 'wait' AND _wait_session IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.job_adjustments
      WHERE wait_session_id = _wait_session
    ) THEN
      _payout := 0;
      _kind := NULL;
    END IF;
  END IF;

  -- Skip duplicate no_show / cancellation adjustments per job.
  IF _payout > 0 AND _kind IN ('no_show','cancellation') THEN
    IF EXISTS (
      SELECT 1 FROM public.job_adjustments
      WHERE job_id = NEW.job_id AND kind = _kind
    ) THEN
      _payout := 0;
      _kind := NULL;
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
      )
      RETURNING id INTO _adj_id;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'apply_trip_event_impact: adjustment insert failed: %', SQLERRM;
    END;
  END IF;

  IF _trust <> 0 AND NEW.driver_id IS NOT NULL THEN
    UPDATE public.drivers
      SET trust_score = GREATEST(0, LEAST(200, trust_score + _trust)),
          trust_updated_at = now()
      WHERE id = NEW.driver_id;
  END IF;

  NEW.payout_delta_eur := COALESCE(_payout, 0);
  NEW.trust_delta      := COALESCE(_trust, 0);
  NEW.adjustment_id    := _adj_id;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'apply_trip_event_impact failed: %', SQLERRM;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_trip_map_events_impact ON public.trip_map_events;
CREATE TRIGGER trg_trip_map_events_impact
BEFORE INSERT ON public.trip_map_events
FOR EACH ROW EXECUTE FUNCTION public.apply_trip_event_impact();

-- 4) Backfill payout/trust deltas on existing events (informational only —
--    do NOT create new job_adjustments for historical events, since the app's
--    manual flows already produced them).
UPDATE public.trip_map_events e SET
  payout_delta_eur = CASE e.event_type
    WHEN 'wait_ended' THEN COALESCE(
      NULLIF((e.meta->>'agreed_amount')::numeric, 0),
      (e.meta->>'calculated_amount')::numeric, 0)
    WHEN 'pax_no_show' THEN 10.00
    WHEN 'pax_cancelled' THEN 5.00
    ELSE 0
  END,
  trust_delta = CASE e.event_type
    WHEN 'completed' THEN 2
    WHEN 'pax_no_show' THEN 1
    WHEN 'arrived_pickup_override' THEN -5
    WHEN 'status_corrected' THEN -3
    WHEN 'boarding_rejected' THEN -2
    WHEN 'emergency_override' THEN -1
    WHEN 'safety_concern' THEN -1
    WHEN 'breakdown' THEN -1
    ELSE 0
  END
WHERE e.payout_delta_eur = 0 AND e.trust_delta = 0;

-- 5) Recompute driver trust_score from historical deltas (clamped 0..200).
WITH totals AS (
  SELECT driver_id, SUM(trust_delta)::int AS d
  FROM public.trip_map_events
  WHERE driver_id IS NOT NULL AND trust_delta <> 0
  GROUP BY driver_id
)
UPDATE public.drivers d
   SET trust_score = GREATEST(0, LEAST(200, 100 + t.d)),
       trust_updated_at = now()
  FROM totals t
 WHERE d.id = t.driver_id;
