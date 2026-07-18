
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS referred_by_company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS referral_percent numeric(5,2) NOT NULL DEFAULT 5.00,
  ADD COLUMN IF NOT EXISTS referral_credit_until timestamptz;

CREATE INDEX IF NOT EXISTS idx_companies_referred_by ON public.companies(referred_by_company_id);

-- Slug + short suffix generator for referral codes
CREATE OR REPLACE FUNCTION public.ensure_referral_code(_company_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text;
  v_name text;
  v_base text;
  v_try text;
  v_i int := 0;
BEGIN
  SELECT referral_code, name INTO v_code, v_name
    FROM public.companies WHERE id = _company_id;
  IF v_code IS NOT NULL AND length(v_code) > 0 THEN
    RETURN v_code;
  END IF;
  v_base := lower(regexp_replace(coalesce(v_name, 'ref'), '[^a-zA-Z0-9]+', '-', 'g'));
  v_base := trim(both '-' from v_base);
  IF length(v_base) < 2 THEN v_base := 'ref'; END IF;
  IF length(v_base) > 24 THEN v_base := substring(v_base from 1 for 24); END IF;
  LOOP
    v_try := v_base || '-' || substring(md5(random()::text || _company_id::text || v_i::text) from 1 for 4);
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.companies WHERE referral_code = v_try);
    v_i := v_i + 1;
    IF v_i > 20 THEN RAISE EXCEPTION 'could not generate unique referral code'; END IF;
  END LOOP;
  UPDATE public.companies SET referral_code = v_try WHERE id = _company_id;
  RETURN v_try;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_referral_code(uuid) TO authenticated, service_role;

-- Kickback trigger on points_ledger
CREATE OR REPLACE FUNCTION public.apply_referral_kickback()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ref_id uuid;
  v_pct numeric;
  v_until timestamptz;
  v_credit numeric;
BEGIN
  IF NEW.points_deducted IS NULL OR NEW.points_deducted <= 0 THEN
    RETURN NEW;
  END IF;
  -- Skip kickback rows themselves (they carry a marker note prefix)
  IF NEW.note LIKE 'Referral kickback%' OR NEW.note LIKE 'REFUND:%' THEN
    RETURN NEW;
  END IF;
  SELECT referred_by_company_id, referral_percent, referral_credit_until
    INTO v_ref_id, v_pct, v_until
    FROM public.companies WHERE id = NEW.company_id;
  IF v_ref_id IS NULL OR v_pct IS NULL OR v_pct <= 0 THEN
    RETURN NEW;
  END IF;
  IF v_until IS NOT NULL AND v_until < now() THEN
    RETURN NEW;
  END IF;
  v_credit := round((NEW.points_deducted * v_pct / 100.0)::numeric, 2);
  IF v_credit <= 0 THEN RETURN NEW; END IF;
  INSERT INTO public.points_ledger (company_id, feature_key, points_deducted, note)
  VALUES (v_ref_id, NEW.feature_key, -v_credit,
          'Referral kickback ' || v_pct::text || '% from ' || coalesce(NEW.company_id::text, ''));
  UPDATE public.companies
     SET points_balance = coalesce(points_balance, 0) + v_credit
   WHERE id = v_ref_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_referral_kickback ON public.points_ledger;
CREATE TRIGGER trg_apply_referral_kickback
  AFTER INSERT ON public.points_ledger
  FOR EACH ROW EXECUTE FUNCTION public.apply_referral_kickback();

-- Link on approval
CREATE OR REPLACE FUNCTION public.link_referral_on_approve()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ref_company uuid;
  v_target uuid;
BEGIN
  IF NEW.status <> 'approved' OR NEW.referral_code IS NULL THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'approved' THEN
    RETURN NEW;
  END IF;
  SELECT id INTO v_ref_company FROM public.companies WHERE referral_code = NEW.referral_code LIMIT 1;
  IF v_ref_company IS NULL THEN RETURN NEW; END IF;
  SELECT id INTO v_target
    FROM public.companies
   WHERE lower(email) = lower(NEW.email)
     AND id <> v_ref_company
     AND referred_by_company_id IS NULL
   ORDER BY created_at DESC LIMIT 1;
  IF v_target IS NULL THEN RETURN NEW; END IF;
  UPDATE public.companies
     SET referred_by_company_id = v_ref_company,
         referral_credit_until = now() + interval '12 months'
   WHERE id = v_target;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_link_referral_on_approve ON public.access_requests;
CREATE TRIGGER trg_link_referral_on_approve
  AFTER UPDATE ON public.access_requests
  FOR EACH ROW EXECUTE FUNCTION public.link_referral_on_approve();
