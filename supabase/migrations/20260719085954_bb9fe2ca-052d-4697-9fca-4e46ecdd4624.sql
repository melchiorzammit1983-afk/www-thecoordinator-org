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
          points_remaining_this_period = COALESCE(_plan.included_points, 0)
      WHERE id = _row.id;
    UPDATE public.companies
      SET ai_points_used_this_period = 0,
          ai_period_reset_at = now()
      WHERE id = _row.company_id;
    _count := _count + 1;
  END LOOP;

  UPDATE company_feature_entitlements
    SET usage_this_period = 0, period_reset_at = now()
    WHERE period_reset_at < now() - interval '30 days';

  UPDATE public.driver_ai_usage
    SET questions_used = 0, period_start = now()
    WHERE period_start < now() - interval '30 days';

  RETURN _count;
END;
$function$;