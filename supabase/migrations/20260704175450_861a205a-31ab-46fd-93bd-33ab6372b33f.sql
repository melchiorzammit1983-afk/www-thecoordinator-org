
DROP FUNCTION IF EXISTS public.spend_points(uuid, text, uuid, text, integer);

ALTER TABLE public.ai_feature_costs ALTER COLUMN points_cost TYPE numeric(10,2);
ALTER TABLE public.feature_costs    ALTER COLUMN points_cost TYPE numeric(10,2);
ALTER TABLE public.points_ledger    ALTER COLUMN points_deducted TYPE numeric(10,2);
ALTER TABLE public.companies        ALTER COLUMN points_balance TYPE numeric(10,2);
ALTER TABLE public.company_subscriptions ALTER COLUMN points_remaining_this_period TYPE numeric(10,2);
ALTER TABLE public.plans            ALTER COLUMN included_points TYPE numeric(10,2);

ALTER TABLE public.ai_feature_costs
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'ai',
  ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS block_on_empty boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS public.company_feature_price_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  feature_key text NOT NULL,
  points_cost numeric(10,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, feature_key)
);

GRANT SELECT ON public.company_feature_price_overrides TO authenticated;
GRANT ALL ON public.company_feature_price_overrides TO service_role;

ALTER TABLE public.company_feature_price_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read overrides" ON public.company_feature_price_overrides
  FOR SELECT TO authenticated USING (private.is_admin(auth.uid()));
CREATE POLICY "admins write overrides" ON public.company_feature_price_overrides
  FOR ALL TO authenticated USING (private.is_admin(auth.uid())) WITH CHECK (private.is_admin(auth.uid()));

CREATE TRIGGER trg_cfpo_updated_at BEFORE UPDATE ON public.company_feature_price_overrides
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.ai_feature_costs (feature_key, label, points_cost, category, enabled, block_on_empty) VALUES
  ('trip_created',           'Trip created',                 1.50, 'core',  true, false),
  ('trip_dispatched',        'Trip dispatched to partner',   0.50, 'core',  true, false),
  ('client_link_sent',       'Client tracking link / SMS',   0.25, 'comms', true, true),
  ('route_traffic_refresh',  'Route + traffic recompute',    0.10, 'data',  true, true),
  ('flight_status_refresh',  'Flight status poll',           0.10, 'data',  true, true)
ON CONFLICT (feature_key) DO NOTHING;

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
  _block boolean := true;
BEGIN
  IF _company_id IS NULL THEN RAISE EXCEPTION 'missing_company'; END IF;

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

CREATE OR REPLACE FUNCTION public.admin_grant_points(_company_id uuid, _points numeric, _note text DEFAULT NULL::text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.companies SET points_balance = points_balance + _points WHERE id = _company_id;
  INSERT INTO public.points_ledger (company_id, feature_key, points_deducted, note)
    VALUES (_company_id, 'admin_grant', -_points, COALESCE(_note, 'admin grant'));
END;
$function$;
