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
  _remaining numeric(10,2);
  _block boolean := true;
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

  -- Entitlement gates
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

  -- Unified spend: subscription pool first, then general balance. No AI wallet split.
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