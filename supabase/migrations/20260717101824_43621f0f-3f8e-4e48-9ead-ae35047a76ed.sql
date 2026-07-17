-- =========================================================================
-- AI WALLET FOUNDATION
-- =========================================================================

-- 1. Wallet columns on companies
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS ai_points_balance numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_monthly_cap numeric(10,2) NULL,
  ADD COLUMN IF NOT EXISTS ai_fallback_to_general boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_points_used_this_period numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_period_reset_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.company_subscriptions
  ADD COLUMN IF NOT EXISTS ai_points_remaining_this_period numeric(10,2) NOT NULL DEFAULT 0;

ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS included_ai_points numeric(10,2) NOT NULL DEFAULT 0;

-- 2. Extend the sensitive-fields trigger to also protect ai_points_balance / cap
--    unless the caller sets a session bypass (used by our SECURITY DEFINER RPCs).
CREATE OR REPLACE FUNCTION public.enforce_company_owner_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'private'
AS $function$
BEGIN
  IF session_user = 'service_role' OR current_user = 'service_role' THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF current_setting('app.wallet_bypass', true) = '1' THEN RETURN NEW; END IF;
  IF private.is_admin(auth.uid()) THEN RETURN NEW; END IF;
  IF NEW.points_balance IS DISTINCT FROM OLD.points_balance
     OR NEW.ai_points_balance IS DISTINCT FROM OLD.ai_points_balance
     OR NEW.ai_monthly_cap IS DISTINCT FROM OLD.ai_monthly_cap
     OR NEW.ai_points_used_this_period IS DISTINCT FROM OLD.ai_points_used_this_period
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id THEN
    RAISE EXCEPTION 'only_admin_can_update_sensitive_company_fields';
  END IF;
  RETURN NEW;
END $function$;

-- 3. Rewrite spend_points to route ai_* keys through the wallet cascade
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
  _is_ai boolean := (_feature_key LIKE 'ai\_%' ESCAPE '\');
  _take numeric(10,2);
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

  -- Entitlement gates (existing behaviour retained)
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

  -- ---- AI wallet cascade -------------------------------------------------
  IF _is_ai THEN
    SELECT * INTO _co FROM public.companies WHERE id = _company_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'company_not_found'; END IF;

    -- Enforce monthly AI cap
    IF _co.ai_monthly_cap IS NOT NULL
       AND _co.ai_points_used_this_period + _cost > _co.ai_monthly_cap THEN
      RAISE EXCEPTION 'ai_monthly_cap_reached';
    END IF;

    _remaining := _cost;

    -- (a) subscription AI allowance
    SELECT * INTO _sub FROM public.company_subscriptions
      WHERE company_id = _company_id FOR UPDATE;
    IF FOUND AND _sub.ai_points_remaining_this_period > 0 THEN
      _take := LEAST(_remaining, _sub.ai_points_remaining_this_period);
      UPDATE public.company_subscriptions
        SET ai_points_remaining_this_period = ai_points_remaining_this_period - _take
        WHERE id = _sub.id;
      _remaining := _remaining - _take;
    END IF;

    -- (b) admin-granted AI wallet
    IF _remaining > 0 AND _co.ai_points_balance > 0 THEN
      _take := LEAST(_remaining, _co.ai_points_balance);
      UPDATE public.companies
        SET ai_points_balance = ai_points_balance - _take
        WHERE id = _company_id;
      _remaining := _remaining - _take;
    END IF;

    -- (c) optional fallback to general points
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
      -- non-blocking: allow to go negative on ai_points_balance
      UPDATE public.companies
        SET ai_points_balance = ai_points_balance - _remaining
        WHERE id = _company_id;
    END IF;

    UPDATE public.companies
      SET ai_points_used_this_period = ai_points_used_this_period + _cost
      WHERE id = _company_id;

  ELSE
    -- ---- Non-AI (existing behaviour) --------------------------------------
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

-- 4. Rollover: include AI allowance + driver quota reset
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
          ai_period_reset_at = now()
      WHERE id = _row.company_id;
    _count := _count + 1;
  END LOOP;

  UPDATE company_feature_entitlements
    SET usage_this_period = 0, period_reset_at = now()
    WHERE period_reset_at < now() - interval '30 days';

  -- Reset driver Guide quotas monthly
  UPDATE public.driver_ai_usage
    SET questions_used = 0, period_start = now()
    WHERE period_start < now() - interval '30 days';

  RETURN _count;
END;
$function$;

-- 5. RPCs
CREATE OR REPLACE FUNCTION public.allocate_to_ai_wallet(_company_id uuid, _amount numeric)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
DECLARE _bal numeric(10,2);
BEGIN
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;
  IF NOT (private.is_admin(auth.uid()) OR private.is_company_owner(auth.uid(), _company_id)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  PERFORM set_config('app.wallet_bypass', '1', true);

  UPDATE public.companies
    SET points_balance = points_balance - _amount,
        ai_points_balance = ai_points_balance + _amount
    WHERE id = _company_id AND points_balance >= _amount
    RETURNING ai_points_balance INTO _bal;
  IF NOT FOUND THEN RAISE EXCEPTION 'insufficient_general_points'; END IF;

  INSERT INTO public.points_ledger (company_id, feature_key, points_deducted, note)
    VALUES (_company_id, 'ai_wallet_topup', _amount, 'coordinator allocation general → AI');
  RETURN _bal;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_grant_ai_points(_company_id uuid, _amount numeric, _note text DEFAULT NULL::text)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
DECLARE _bal numeric(10,2);
BEGIN
  IF NOT private.is_admin(auth.uid()) THEN RAISE EXCEPTION 'admin_only'; END IF;
  IF _amount IS NULL OR _amount = 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;
  PERFORM set_config('app.wallet_bypass', '1', true);

  UPDATE public.companies
    SET ai_points_balance = ai_points_balance + _amount
    WHERE id = _company_id
    RETURNING ai_points_balance INTO _bal;
  IF NOT FOUND THEN RAISE EXCEPTION 'company_not_found'; END IF;

  INSERT INTO public.points_ledger (company_id, feature_key, points_deducted, note)
    VALUES (_company_id, 'admin_ai_grant', -_amount, COALESCE(_note, 'admin AI grant'));
  RETURN _bal;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_ai_monthly_cap(_company_id uuid, _cap numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
BEGIN
  IF NOT (private.is_admin(auth.uid()) OR private.is_company_owner(auth.uid(), _company_id)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  PERFORM set_config('app.wallet_bypass', '1', true);
  UPDATE public.companies SET ai_monthly_cap = _cap WHERE id = _company_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_ai_fallback(_company_id uuid, _enabled boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
BEGIN
  IF NOT (private.is_admin(auth.uid()) OR private.is_company_owner(auth.uid(), _company_id)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  PERFORM set_config('app.wallet_bypass', '1', true);
  UPDATE public.companies SET ai_fallback_to_general = COALESCE(_enabled, false) WHERE id = _company_id;
END;
$function$;

-- =========================================================================
-- NEW TABLES
-- =========================================================================

-- Support tickets
CREATE TABLE IF NOT EXISTS public.support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id uuid NULL REFERENCES public.companies(id) ON DELETE SET NULL,
  subject text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  priority text NOT NULL DEFAULT 'medium',
  route text NULL,
  viewport text NULL,
  ai_thread jsonb NULL,
  admin_unread boolean NOT NULL DEFAULT true,
  user_unread boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz NULL
);
GRANT SELECT, INSERT, UPDATE ON public.support_tickets TO authenticated;
GRANT ALL ON public.support_tickets TO service_role;
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user reads own tickets" ON public.support_tickets FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR private.is_admin(auth.uid()));
CREATE POLICY "user creates own tickets" ON public.support_tickets FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "user or admin updates" ON public.support_tickets FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR private.is_admin(auth.uid()))
  WITH CHECK (user_id = auth.uid() OR private.is_admin(auth.uid()));
CREATE INDEX IF NOT EXISTS support_tickets_user_idx ON public.support_tickets(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS support_tickets_admin_idx ON public.support_tickets(status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.support_ticket_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  author text NOT NULL CHECK (author IN ('user','admin','ai','system')),
  author_user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.support_ticket_messages TO authenticated;
GRANT ALL ON public.support_ticket_messages TO service_role;
ALTER TABLE public.support_ticket_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "reads if ticket visible" ON public.support_ticket_messages FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.support_tickets t WHERE t.id = ticket_id
    AND (t.user_id = auth.uid() OR private.is_admin(auth.uid()))));
CREATE POLICY "writes if ticket visible" ON public.support_ticket_messages FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.support_tickets t WHERE t.id = ticket_id
    AND (t.user_id = auth.uid() OR private.is_admin(auth.uid()))));
CREATE INDEX IF NOT EXISTS support_ticket_messages_idx ON public.support_ticket_messages(ticket_id, created_at);

-- Help-AI chat log (Guide)
CREATE TABLE IF NOT EXISTS public.help_ai_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  company_id uuid NULL REFERENCES public.companies(id) ON DELETE SET NULL,
  route text NULL,
  question text NOT NULL,
  answer text NULL,
  confidence numeric(3,2) NULL,
  thumbs smallint NULL CHECK (thumbs IN (-1,0,1)),
  escalated_ticket_id uuid NULL REFERENCES public.support_tickets(id) ON DELETE SET NULL,
  sources_used jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.help_ai_log TO authenticated;
GRANT ALL ON public.help_ai_log TO service_role;
ALTER TABLE public.help_ai_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user reads own log" ON public.help_ai_log FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR private.is_admin(auth.uid()));
CREATE POLICY "user inserts own log" ON public.help_ai_log FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR user_id IS NULL);
CREATE POLICY "user updates own log" ON public.help_ai_log FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR private.is_admin(auth.uid()))
  WITH CHECK (user_id = auth.uid() OR private.is_admin(auth.uid()));
CREATE INDEX IF NOT EXISTS help_ai_log_created_idx ON public.help_ai_log(created_at DESC);
CREATE INDEX IF NOT EXISTS help_ai_log_confidence_idx ON public.help_ai_log(confidence);

-- Insight clusters (admin-only)
CREATE TABLE IF NOT EXISTS public.ai_insight_clusters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  title text NOT NULL,
  summary text NOT NULL,
  question_count integer NOT NULL DEFAULT 0,
  sample_questions jsonb NULL,
  suggested_fix text NULL,
  lovable_prompt text NULL,
  status text NOT NULL DEFAULT 'new',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.ai_insight_clusters TO service_role;
GRANT SELECT, UPDATE ON public.ai_insight_clusters TO authenticated;
ALTER TABLE public.ai_insight_clusters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin only clusters" ON public.ai_insight_clusters FOR ALL TO authenticated
  USING (private.is_admin(auth.uid())) WITH CHECK (private.is_admin(auth.uid()));

-- Company AI shortcuts (learned mappings)
CREATE TABLE IF NOT EXISTS public.company_ai_shortcuts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  shortcut text NOT NULL,
  expansion text NOT NULL,
  kind text NOT NULL DEFAULT 'general',
  uses integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, shortcut)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_ai_shortcuts TO authenticated;
GRANT ALL ON public.company_ai_shortcuts TO service_role;
ALTER TABLE public.company_ai_shortcuts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "coordinator manages own shortcuts" ON public.company_ai_shortcuts FOR ALL TO authenticated
  USING (private.is_company_owner(auth.uid(), company_id) OR private.is_admin(auth.uid()))
  WITH CHECK (private.is_company_owner(auth.uid(), company_id) OR private.is_admin(auth.uid()));

-- AI alerts (proactive banners)
CREATE TABLE IF NOT EXISTS public.ai_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  job_id uuid NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  driver_id uuid NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  kind text NOT NULL,
  severity text NOT NULL DEFAULT 'info',
  title text NOT NULL,
  detail text NULL,
  suggestion jsonb NULL,
  dismissed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.ai_alerts TO authenticated;
GRANT ALL ON public.ai_alerts TO service_role;
ALTER TABLE public.ai_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "company reads own alerts" ON public.ai_alerts FOR SELECT TO authenticated
  USING (private.is_company_owner(auth.uid(), company_id) OR private.is_admin(auth.uid()));
CREATE POLICY "company dismisses own alerts" ON public.ai_alerts FOR UPDATE TO authenticated
  USING (private.is_company_owner(auth.uid(), company_id) OR private.is_admin(auth.uid()))
  WITH CHECK (private.is_company_owner(auth.uid(), company_id) OR private.is_admin(auth.uid()));
CREATE INDEX IF NOT EXISTS ai_alerts_company_idx ON public.ai_alerts(company_id, created_at DESC) WHERE dismissed_at IS NULL;

-- Driver Guide quota
CREATE TABLE IF NOT EXISTS public.driver_ai_usage (
  driver_id uuid PRIMARY KEY REFERENCES public.drivers(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  period_start timestamptz NOT NULL DEFAULT now(),
  questions_used integer NOT NULL DEFAULT 0,
  monthly_quota integer NOT NULL DEFAULT 30,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.driver_ai_usage TO authenticated;
GRANT ALL ON public.driver_ai_usage TO service_role;
ALTER TABLE public.driver_ai_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "driver or coordinator reads" ON public.driver_ai_usage FOR SELECT TO authenticated
  USING (
    private.is_admin(auth.uid())
    OR private.is_company_owner(auth.uid(), company_id)
    OR EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = driver_id AND d.linked_user_id = auth.uid())
  );
CREATE POLICY "coordinator updates quota" ON public.driver_ai_usage FOR UPDATE TO authenticated
  USING (private.is_admin(auth.uid()) OR private.is_company_owner(auth.uid(), company_id))
  WITH CHECK (private.is_admin(auth.uid()) OR private.is_company_owner(auth.uid(), company_id));

-- Driver quota RPC: increment-or-charge (server-only insert via service_role in server fn)
CREATE OR REPLACE FUNCTION public.driver_guide_consume(_driver_id uuid, _company_id uuid)
 RETURNS TABLE(used_free boolean, remaining_free integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _row record;
BEGIN
  INSERT INTO public.driver_ai_usage (driver_id, company_id)
    VALUES (_driver_id, _company_id)
    ON CONFLICT (driver_id) DO NOTHING;

  SELECT * INTO _row FROM public.driver_ai_usage WHERE driver_id = _driver_id FOR UPDATE;

  IF _row.questions_used < _row.monthly_quota THEN
    UPDATE public.driver_ai_usage
      SET questions_used = questions_used + 1, updated_at = now()
      WHERE driver_id = _driver_id;
    RETURN QUERY SELECT true, _row.monthly_quota - _row.questions_used - 1;
  ELSE
    RETURN QUERY SELECT false, 0;
  END IF;
END;
$function$;

-- =========================================================================
-- SEED AI feature costs (new keys)
-- =========================================================================
INSERT INTO public.ai_feature_costs (feature_key, points_cost, enabled, block_on_empty)
VALUES
  ('ai_guide_chat',       1.00, true,  true),
  ('ai_guide_escalate',   0.00, true,  false),
  ('ai_bulk_clarify',     1.00, true,  true),
  ('ai_prompt_improve',   1.00, true,  true),
  ('ai_explain_answer',   1.00, true,  true),
  ('ai_dispatch_coach',   2.00, true,  true),
  ('ai_self_heal',        2.00, true,  true),
  ('ai_anomaly_scan',     1.00, true,  false),
  ('ai_ops_digest',       3.00, true,  false),
  ('ai_prompt_suggest',   0.00, true,  false)
ON CONFLICT (feature_key) DO NOTHING;

-- =========================================================================
-- ONE-TIME BALANCE MIGRATION: copy points_balance → ai_points_balance
-- =========================================================================
DO $$
DECLARE _r record;
BEGIN
  PERFORM set_config('app.wallet_bypass', '1', true);
  FOR _r IN SELECT id, points_balance FROM public.companies WHERE points_balance > 0 LOOP
    UPDATE public.companies
      SET ai_points_balance = ai_points_balance + _r.points_balance,
          points_balance = 0
      WHERE id = _r.id;
    INSERT INTO public.points_ledger (company_id, feature_key, points_deducted, note)
      VALUES (_r.id, 'ai_wallet_migration', -_r.points_balance,
              'one-time migration: general → AI wallet');
  END LOOP;
END $$;
