
ALTER TABLE public.ai_feature_costs
  ADD COLUMN IF NOT EXISTS est_cost_usd_cents numeric(10,4);

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS ai_free_monthly_points numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_free_points_used_this_period numeric(10,2) NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.spend_points(_company_id uuid, _feature_key text, _job_id uuid DEFAULT NULL::uuid, _note text DEFAULT NULL::text, _cost_override numeric DEFAULT NULL::numeric)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _cost numeric(10,2);
  _feat record;
  _override numeric(10,2);
  _sub record;
  _ent record;
  _co record;
  _remaining numeric(10,2);
  _block boolean := true;
  _is_ai boolean := (_feature_key LIKE 'ai\_%' ESCAPE '\' OR _feature_key LIKE 'assistant\_%' ESCAPE '\');
  _take numeric(10,2);
  _free_left numeric(10,2);
BEGIN
  IF _company_id IS NULL THEN RAISE EXCEPTION 'missing_company'; END IF;
  PERFORM set_config('app.wallet_bypass', '1', true);

  SELECT points_cost, enabled, block_on_empty INTO _feat
    FROM public.ai_feature_costs WHERE feature_key = _feature_key;
  IF FOUND THEN
    IF NOT _feat.enabled THEN RAISE EXCEPTION 'feature_disabled'; END IF;
    _block := COALESCE(_feat.block_on_empty, true);
  END IF;

  IF _cost_override IS NOT NULL THEN
    _cost := _cost_override;
  ELSE
    SELECT points_cost INTO _override
      FROM public.company_feature_price_overrides
      WHERE company_id = _company_id AND feature_key = _feature_key;
    _cost := COALESCE(_override, _feat.points_cost, 1);
  END IF;

  SELECT enabled, expires_at, monthly_cap, usage_this_period INTO _ent
    FROM public.company_feature_entitlements
    WHERE company_id = _company_id AND feature = _feature_key;
  IF FOUND THEN
    IF NOT _ent.enabled OR (_ent.expires_at IS NOT NULL AND _ent.expires_at <= now()) THEN
      RAISE EXCEPTION 'feature_disabled';
    END IF;
    IF _ent.monthly_cap IS NOT NULL AND _ent.usage_this_period + 1 > _ent.monthly_cap THEN
      RAISE EXCEPTION 'feature_capped';
    END IF;
  END IF;

  IF _is_ai THEN
    SELECT * INTO _co FROM public.companies WHERE id = _company_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'company_not_found'; END IF;

    IF _co.ai_monthly_cap IS NOT NULL
       AND _co.ai_points_used_this_period + _cost > _co.ai_monthly_cap THEN
      RAISE EXCEPTION 'ai_monthly_cap_reached';
    END IF;

    _remaining := _cost;

    _free_left := GREATEST(0, COALESCE(_co.ai_free_monthly_points, 0) - COALESCE(_co.ai_free_points_used_this_period, 0));
    IF _remaining > 0 AND _free_left > 0 THEN
      _take := LEAST(_remaining, _free_left);
      UPDATE public.companies
        SET ai_free_points_used_this_period = ai_free_points_used_this_period + _take
        WHERE id = _company_id;
      _remaining := _remaining - _take;
    END IF;

    SELECT * INTO _sub FROM public.company_subscriptions WHERE company_id = _company_id FOR UPDATE;
    IF _remaining > 0 AND FOUND AND _sub.ai_points_remaining_this_period > 0 THEN
      _take := LEAST(_remaining, _sub.ai_points_remaining_this_period);
      UPDATE public.company_subscriptions
        SET ai_points_remaining_this_period = ai_points_remaining_this_period - _take
        WHERE id = _sub.id;
      _remaining := _remaining - _take;
    END IF;

    IF _remaining > 0 AND _co.ai_points_balance > 0 THEN
      _take := LEAST(_remaining, _co.ai_points_balance);
      UPDATE public.companies
        SET ai_points_balance = ai_points_balance - _take
        WHERE id = _company_id;
      _remaining := _remaining - _take;
    END IF;

    IF _remaining > 0 AND COALESCE(_co.ai_fallback_to_general, false) THEN
      IF _co.points_balance >= _remaining THEN
        UPDATE public.companies
          SET points_balance = points_balance - _remaining
          WHERE id = _company_id;
        _remaining := 0;
      END IF;
    END IF;

    IF _remaining > 0 THEN
      IF _block THEN
        RAISE EXCEPTION 'insufficient_ai_points';
      END IF;
      UPDATE public.companies
        SET ai_points_balance = ai_points_balance - _remaining
        WHERE id = _company_id;
    END IF;

    UPDATE public.companies
      SET ai_points_used_this_period = ai_points_used_this_period + _cost
      WHERE id = _company_id;
  ELSE
    SELECT * INTO _sub FROM public.company_subscriptions WHERE company_id = _company_id FOR UPDATE;
    IF FOUND AND _sub.points_remaining_this_period >= _cost THEN
      UPDATE public.company_subscriptions
        SET points_remaining_this_period = points_remaining_this_period - _cost
        WHERE id = _sub.id
        RETURNING points_remaining_this_period INTO _remaining;
    ELSE
      IF _block THEN
        UPDATE public.companies SET points_balance = points_balance - _cost
          WHERE id = _company_id AND points_balance >= _cost
          RETURNING points_balance INTO _remaining;
        IF NOT FOUND THEN RAISE EXCEPTION 'insufficient_points'; END IF;
      ELSE
        UPDATE public.companies SET points_balance = points_balance - _cost
          WHERE id = _company_id
          RETURNING points_balance INTO _remaining;
      END IF;
    END IF;
  END IF;

  IF _ent.monthly_cap IS NOT NULL THEN
    UPDATE public.company_feature_entitlements
      SET usage_this_period = usage_this_period + 1
      WHERE company_id = _company_id AND feature = _feature_key;
  END IF;

  INSERT INTO public.points_ledger (company_id, job_id, feature_key, points_deducted, note)
    VALUES (_company_id, _job_id, _feature_key, _cost, _note);

  RETURN _cost;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rollover_subscriptions()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _count integer := 0;
  _row record;
  _plan record;
BEGIN
  PERFORM set_config('app.wallet_bypass', '1', true);

  FOR _row IN SELECT * FROM company_subscriptions WHERE current_period_end <= now() AND status = 'active' LOOP
    SELECT * INTO _plan FROM plans WHERE id = _row.plan_id;
    UPDATE company_subscriptions
      SET current_period_start = now(),
          current_period_end   = now() + interval '30 days',
          points_remaining_this_period = COALESCE(_plan.included_points, 0),
          ai_points_remaining_this_period = COALESCE(_plan.included_ai_points, 0)
      WHERE id = _row.id;
    UPDATE public.companies
      SET ai_points_used_this_period = 0,
          ai_free_points_used_this_period = 0,
          ai_period_reset_at = now()
      WHERE id = _row.company_id;
    _count := _count + 1;
  END LOOP;

  UPDATE public.companies
    SET ai_free_points_used_this_period = 0
    WHERE ai_period_reset_at IS NULL
       OR ai_period_reset_at < now() - interval '30 days';

  UPDATE company_feature_entitlements
    SET usage_this_period = 0, period_reset_at = now()
    WHERE period_reset_at < now() - interval '30 days';

  UPDATE public.driver_ai_usage
    SET questions_used = 0, period_start = now()
    WHERE period_start < now() - interval '30 days';

  RETURN _count;
END;
$function$;
