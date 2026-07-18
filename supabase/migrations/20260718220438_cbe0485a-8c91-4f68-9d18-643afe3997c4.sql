
-- 1) Plans: add knobs, drop unused AI allowance
ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS driver_cap INTEGER,
  ADD COLUMN IF NOT EXISTS trial_days INTEGER NOT NULL DEFAULT 14,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE public.plans DROP COLUMN IF EXISTS included_ai_points;

-- Order plans by price
INSERT INTO public.plans (code, name, price_monthly, included_points, feature_keys, sort_order, description, driver_cap, trial_days)
VALUES ('trial', 'Free trial', 0, 50, ARRAY['dispatch','drivers','statements','labels','ai_assistant','flight_tracking'], -1,
        'Full access for 14 days.', 3, 14)
ON CONFLICT (code) DO NOTHING;

UPDATE public.plans SET description = COALESCE(description,
  CASE code
    WHEN 'starter' THEN 'For small teams starting out.'
    WHEN 'pro' THEN 'Adds AI, portals, and collaborate.'
    WHEN 'business' THEN 'Unlimited drivers with priority support.'
    ELSE ''
  END),
  driver_cap = COALESCE(driver_cap,
    CASE code
      WHEN 'trial' THEN 3
      WHEN 'starter' THEN 5
      WHEN 'pro' THEN 20
      WHEN 'business' THEN NULL
    END);

-- 2) Company subscriptions: drop separate AI wallet
ALTER TABLE public.company_subscriptions
  DROP COLUMN IF EXISTS ai_points_remaining_this_period;

-- 3) Companies: trial + grace
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS grace_actions_remaining INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS grace_reset_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- 4) Extend the canonical feature catalog (ai_feature_costs)
ALTER TABLE public.ai_feature_costs
  ADD COLUMN IF NOT EXISTS min_plan_code TEXT,      -- NULL = available on every plan (incl. trial)
  ADD COLUMN IF NOT EXISTS is_addon BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

-- Backfill labels from the key when blank so admin UI is scannable
UPDATE public.ai_feature_costs
  SET label = COALESCE(NULLIF(label,''), initcap(replace(feature_key,'_',' ')));

-- Import any keys from the old classic feature_costs table not already present
INSERT INTO public.ai_feature_costs (feature_key, points_cost, label, category, enabled, block_on_empty, metering_mode)
SELECT
  fc.feature_name::text,
  fc.points_cost,
  initcap(replace(fc.feature_name::text,'_',' ')),
  'dispatch',
  true,
  false,
  'per_action'
FROM public.feature_costs fc
LEFT JOIN public.ai_feature_costs a ON a.feature_key = fc.feature_name::text
WHERE a.feature_key IS NULL;

-- Default min_plan_code for AI/portal features so trial is generous but starter is not overloaded
UPDATE public.ai_feature_costs SET min_plan_code = 'pro'
  WHERE min_plan_code IS NULL AND (
    feature_key LIKE 'portal_%' OR feature_key LIKE '%auto_coordinate%' OR feature_key LIKE '%watchtower%'
    OR feature_key = 'ai_auto_assign' OR feature_key = 'ai_daily_plan'
  );

-- 5) Rewrite spend_points to enforce plan gate + grace bucket
CREATE OR REPLACE FUNCTION public.spend_points(
  _company_id uuid,
  _feature_key text,
  _job_id uuid DEFAULT NULL::uuid,
  _note text DEFAULT NULL::text,
  _cost_override numeric DEFAULT NULL::numeric
)
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
  _co record;
  _plan_code text;
  _block boolean := true;
BEGIN
  IF _company_id IS NULL THEN RAISE EXCEPTION 'missing_company'; END IF;

  PERFORM set_config('app.wallet_bypass', '1', true);

  SELECT points_cost, enabled, block_on_empty, min_plan_code
    INTO _feat FROM public.ai_feature_costs WHERE feature_key = _feature_key;
  IF FOUND THEN
    IF NOT _feat.enabled THEN RAISE EXCEPTION 'feature_disabled'; END IF;
    _block := COALESCE(_feat.block_on_empty, true);
  END IF;

  -- Plan gate
  IF _feat.min_plan_code IS NOT NULL THEN
    SELECT p.code INTO _plan_code
      FROM public.company_subscriptions s
      JOIN public.plans p ON p.id = s.plan_id
     WHERE s.company_id = _company_id;
    IF _plan_code IS NULL OR NOT (
      (_feat.min_plan_code = 'starter'  AND _plan_code IN ('trial','starter','pro','business'))
      OR (_feat.min_plan_code = 'pro'      AND _plan_code IN ('trial','pro','business'))
      OR (_feat.min_plan_code = 'business' AND _plan_code IN ('trial','business'))
    ) THEN
      RAISE EXCEPTION 'feature_not_in_plan';
    END IF;
  END IF;

  -- Cost resolution
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

  -- Reset grace counter if the sub period rolled over
  SELECT * INTO _co FROM public.companies WHERE id = _company_id FOR UPDATE;
  IF _co.grace_reset_at IS NULL OR _co.grace_reset_at < date_trunc('month', now()) THEN
    UPDATE public.companies
      SET grace_actions_remaining = 10, grace_reset_at = date_trunc('month', now())
    WHERE id = _company_id
    RETURNING * INTO _co;
  END IF;

  -- 1) Subscription pool first
  SELECT * INTO _sub FROM public.company_subscriptions WHERE company_id = _company_id FOR UPDATE;
  IF FOUND AND _sub.points_remaining_this_period >= _cost THEN
    UPDATE public.company_subscriptions
      SET points_remaining_this_period = points_remaining_this_period - _cost
      WHERE id = _sub.id
      RETURNING points_remaining_this_period INTO _remaining;
  ELSE
    -- 2) Top-up balance
    UPDATE public.companies SET points_balance = points_balance - _cost
      WHERE id = _company_id AND points_balance >= _cost
      RETURNING points_balance INTO _remaining;
    IF NOT FOUND THEN
      -- 3) Grace bucket (soft block)
      IF _block THEN
        IF _co.grace_actions_remaining > 0 THEN
          UPDATE public.companies
            SET grace_actions_remaining = grace_actions_remaining - 1
          WHERE id = _company_id;
        ELSE
          RAISE EXCEPTION 'insufficient_points';
        END IF;
      ELSE
        -- Non-blocking feature: let balance go negative
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

-- 6) Helper: check whether a company has access to a given feature (used by useEntitlements)
CREATE OR REPLACE FUNCTION public.feature_available(_company_id uuid, _feature_key text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH cat AS (
    SELECT enabled, min_plan_code FROM public.ai_feature_costs WHERE feature_key = _feature_key
  ),
  plan AS (
    SELECT p.code FROM public.company_subscriptions s
    JOIN public.plans p ON p.id = s.plan_id
    WHERE s.company_id = _company_id
  ),
  ent AS (
    SELECT enabled, expires_at FROM public.company_feature_entitlements
    WHERE company_id = _company_id AND feature = _feature_key
  )
  SELECT
    COALESCE((SELECT enabled FROM cat), true)
    AND (
      NOT EXISTS (SELECT 1 FROM ent)
      OR (SELECT enabled FROM ent) AND ((SELECT expires_at FROM ent) IS NULL OR (SELECT expires_at FROM ent) > now())
    )
    AND (
      (SELECT min_plan_code FROM cat) IS NULL
      OR (
        (SELECT code FROM plan) IS NOT NULL AND (
             ((SELECT min_plan_code FROM cat) = 'starter'  AND (SELECT code FROM plan) IN ('trial','starter','pro','business'))
          OR ((SELECT min_plan_code FROM cat) = 'pro'      AND (SELECT code FROM plan) IN ('trial','pro','business'))
          OR ((SELECT min_plan_code FROM cat) = 'business' AND (SELECT code FROM plan) IN ('trial','business'))
        )
      )
    );
$$;

REVOKE ALL ON FUNCTION public.feature_available(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.feature_available(uuid, text) TO authenticated, service_role;
