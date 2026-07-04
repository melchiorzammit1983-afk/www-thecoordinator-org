
-- 1. PLANS -----------------------------------------------------------------
CREATE TABLE public.plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  price_monthly numeric(10,2) NOT NULL DEFAULT 0,
  included_points integer NOT NULL DEFAULT 0,
  feature_keys text[] NOT NULL DEFAULT '{}',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.plans TO authenticated;
GRANT ALL ON public.plans TO service_role;
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read plans" ON public.plans FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage plans" ON public.plans FOR ALL TO authenticated
  USING (private.is_admin(auth.uid())) WITH CHECK (private.is_admin(auth.uid()));
CREATE TRIGGER trg_plans_updated_at BEFORE UPDATE ON public.plans FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO public.plans (code, name, price_monthly, included_points, sort_order, feature_keys) VALUES
  ('starter',  'Starter',  0,   50,   1, ARRAY['dispatch','drivers','bulk_paste','chat']),
  ('pro',      'Pro',      49,  500,  2, ARRAY['dispatch','drivers','bulk_paste','chat','labels','statements','portal_links','live_tracking','ai_extraction','ai_group_suggestions','client_trip_portal','pending','my_driving']),
  ('business', 'Business', 149, 2000, 3, ARRAY['dispatch','drivers','bulk_paste','chat','labels','statements','portal_links','live_tracking','ai_extraction','ai_group_suggestions','client_trip_portal','pending','my_driving','flight_tracking','ai_daily_plan','ai_reply_drafter','ai_voice_to_trip','client_push_notifications','client_eta','client_sos','client_offline_mode','branding_advert','collaborate']);

-- 2. POINT PACKS ----------------------------------------------------------
CREATE TABLE public.point_packs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  points integer NOT NULL CHECK (points > 0),
  price numeric(10,2) NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.point_packs TO authenticated;
GRANT ALL ON public.point_packs TO service_role;
ALTER TABLE public.point_packs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read point packs" ON public.point_packs FOR SELECT TO authenticated USING (is_active);
CREATE POLICY "Admins manage point packs" ON public.point_packs FOR ALL TO authenticated
  USING (private.is_admin(auth.uid())) WITH CHECK (private.is_admin(auth.uid()));
CREATE TRIGGER trg_point_packs_updated_at BEFORE UPDATE ON public.point_packs FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO public.point_packs (name, points, price, sort_order) VALUES
  ('Small',   100,   9,   1),
  ('Medium',  500,   39,  2),
  ('Large',   2000,  129, 3),
  ('Mega',    10000, 499, 4);

-- 3. COMPANY SUBSCRIPTIONS -----------------------------------------------
CREATE TABLE public.company_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL UNIQUE REFERENCES public.companies(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES public.plans(id),
  status text NOT NULL DEFAULT 'active',
  current_period_start timestamptz NOT NULL DEFAULT now(),
  current_period_end timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  points_remaining_this_period integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.company_subscriptions TO authenticated;
GRANT ALL ON public.company_subscriptions TO service_role;
ALTER TABLE public.company_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners read own subscription" ON public.company_subscriptions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM companies c WHERE c.id = company_id AND c.owner_user_id = auth.uid()));
CREATE POLICY "Admins manage subscriptions" ON public.company_subscriptions FOR ALL TO authenticated
  USING (private.is_admin(auth.uid())) WITH CHECK (private.is_admin(auth.uid()));
CREATE TRIGGER trg_company_subscriptions_updated_at BEFORE UPDATE ON public.company_subscriptions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 4. EXTEND company_feature_entitlements ---------------------------------
ALTER TABLE public.company_feature_entitlements
  ADD COLUMN IF NOT EXISTS monthly_cap integer,
  ADD COLUMN IF NOT EXISTS usage_this_period integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS period_reset_at timestamptz NOT NULL DEFAULT now();

-- 5. AI feature costs (text-keyed, admin-editable) -----------------------
CREATE TABLE public.ai_feature_costs (
  feature_key text PRIMARY KEY,
  points_cost integer NOT NULL DEFAULT 1 CHECK (points_cost >= 0),
  label text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ai_feature_costs TO authenticated;
GRANT ALL ON public.ai_feature_costs TO service_role;
ALTER TABLE public.ai_feature_costs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read ai costs" ON public.ai_feature_costs FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage ai costs" ON public.ai_feature_costs FOR ALL TO authenticated
  USING (private.is_admin(auth.uid())) WITH CHECK (private.is_admin(auth.uid()));
CREATE TRIGGER trg_ai_feature_costs_updated_at BEFORE UPDATE ON public.ai_feature_costs FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO public.ai_feature_costs (feature_key, points_cost, label) VALUES
  ('ai_extraction',         1, 'AI trip extraction (per message)'),
  ('ai_extraction_media',   3, 'AI trip extraction (per file/URL)'),
  ('ai_group_suggestions',  2, 'AI auto-group suggestions'),
  ('ai_daily_plan',         5, 'AI daily plan (per driver)'),
  ('ai_reply_drafter',      1, 'AI chat reply drafts'),
  ('ai_voice_to_trip',      4, 'AI voice-note to trip');

-- 6. EXTEND topup_requests -----------------------------------------------
ALTER TABLE public.topup_requests
  ADD COLUMN IF NOT EXISTS pack_id uuid REFERENCES public.point_packs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS price numeric(10,2);

-- 7. Extend points_ledger to accept arbitrary feature keys ---------------
ALTER TABLE public.points_ledger
  ADD COLUMN IF NOT EXISTS feature_key text;

-- 8. spend_points RPC ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.spend_points(
  _company_id uuid,
  _feature_key text,
  _job_id uuid DEFAULT NULL,
  _note text DEFAULT NULL,
  _cost_override integer DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _cost integer;
  _sub record;
  _ent record;
  _remaining integer;
BEGIN
  IF _company_id IS NULL THEN RAISE EXCEPTION 'missing_company'; END IF;

  -- Resolve cost (override wins, else lookup)
  IF _cost_override IS NOT NULL THEN
    _cost := _cost_override;
  ELSE
    SELECT points_cost INTO _cost FROM ai_feature_costs WHERE feature_key = _feature_key;
    _cost := COALESCE(_cost, 1);
  END IF;

  -- Entitlement + cap check
  SELECT enabled, expires_at, monthly_cap, usage_this_period
    INTO _ent
    FROM company_feature_entitlements
    WHERE company_id = _company_id AND feature = _feature_key;

  IF FOUND THEN
    IF NOT _ent.enabled OR (_ent.expires_at IS NOT NULL AND _ent.expires_at <= now()) THEN
      RAISE EXCEPTION 'feature_disabled';
    END IF;
    IF _ent.monthly_cap IS NOT NULL AND _ent.usage_this_period + 1 > _ent.monthly_cap THEN
      RAISE EXCEPTION 'feature_capped';
    END IF;
  END IF;

  -- Subscription pool
  SELECT * INTO _sub FROM company_subscriptions WHERE company_id = _company_id FOR UPDATE;
  IF NOT FOUND THEN
    -- No subscription: fall back to legacy points_balance on companies
    UPDATE companies SET points_balance = points_balance - _cost
      WHERE id = _company_id AND points_balance >= _cost
      RETURNING points_balance INTO _remaining;
    IF NOT FOUND THEN RAISE EXCEPTION 'insufficient_points'; END IF;
  ELSE
    IF _sub.points_remaining_this_period >= _cost THEN
      UPDATE company_subscriptions
        SET points_remaining_this_period = points_remaining_this_period - _cost
        WHERE id = _sub.id
        RETURNING points_remaining_this_period INTO _remaining;
    ELSE
      -- Not enough plan points → try to burn from company points_balance
      UPDATE companies SET points_balance = points_balance - _cost
        WHERE id = _company_id AND points_balance >= _cost
        RETURNING points_balance INTO _remaining;
      IF NOT FOUND THEN RAISE EXCEPTION 'insufficient_points'; END IF;
    END IF;
  END IF;

  -- Bump usage counter if entitlement row exists
  IF FOUND AND _ent.monthly_cap IS NOT NULL THEN
    UPDATE company_feature_entitlements
      SET usage_this_period = usage_this_period + 1
      WHERE company_id = _company_id AND feature = _feature_key;
  END IF;

  -- Ledger
  INSERT INTO points_ledger (company_id, job_id, feature_key, points_deducted, note)
    VALUES (_company_id, _job_id, _feature_key, _cost, _note);

  RETURN _cost;
END;
$$;

REVOKE ALL ON FUNCTION public.spend_points(uuid, text, uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.spend_points(uuid, text, uuid, text, integer) TO service_role;

-- 9. Admin helpers -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_grant_points(_company_id uuid, _points integer, _note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE companies SET points_balance = points_balance + _points WHERE id = _company_id;
  INSERT INTO points_ledger (company_id, feature_key, points_deducted, note)
    VALUES (_company_id, 'admin_grant', -_points, COALESCE(_note, 'admin grant'));
END;
$$;
REVOKE ALL ON FUNCTION public.admin_grant_points(uuid, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_grant_points(uuid, integer, text) TO service_role;

CREATE OR REPLACE FUNCTION public.set_company_plan(_company_id uuid, _plan_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _plan record;
BEGIN
  SELECT * INTO _plan FROM plans WHERE id = _plan_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'plan_not_found'; END IF;
  INSERT INTO company_subscriptions (company_id, plan_id, current_period_start, current_period_end, points_remaining_this_period)
    VALUES (_company_id, _plan_id, now(), now() + interval '30 days', _plan.included_points)
    ON CONFLICT (company_id) DO UPDATE
      SET plan_id = EXCLUDED.plan_id,
          current_period_start = now(),
          current_period_end = now() + interval '30 days',
          points_remaining_this_period = _plan.included_points,
          status = 'active';
END;
$$;
REVOKE ALL ON FUNCTION public.set_company_plan(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_company_plan(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.rollover_subscriptions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _count integer := 0;
  _row record;
  _plan record;
BEGIN
  FOR _row IN SELECT * FROM company_subscriptions WHERE current_period_end <= now() AND status = 'active' LOOP
    SELECT * INTO _plan FROM plans WHERE id = _row.plan_id;
    UPDATE company_subscriptions
      SET current_period_start = now(),
          current_period_end   = now() + interval '30 days',
          points_remaining_this_period = COALESCE(_plan.included_points, 0)
      WHERE id = _row.id;
    _count := _count + 1;
  END LOOP;
  UPDATE company_feature_entitlements
    SET usage_this_period = 0, period_reset_at = now()
    WHERE period_reset_at < now() - interval '30 days';
  RETURN _count;
END;
$$;
REVOKE ALL ON FUNCTION public.rollover_subscriptions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rollover_subscriptions() TO service_role;
