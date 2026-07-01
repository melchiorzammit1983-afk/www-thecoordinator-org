
-- ============ ENUMS ============
DO $$ BEGIN CREATE TYPE public.magic_link_kind AS ENUM ('driver','client'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.topup_request_status AS ENUM ('pending','fulfilled','rejected'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============ JOBS EXTENSIONS ============
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS qr_strict_mode boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS driver_id uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS vehicle text,
  ADD COLUMN IF NOT EXISTS pickup_at timestamptz,
  ADD COLUMN IF NOT EXISTS points_charged jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.jobs SET pickup_at = (date::timestamp + time) AT TIME ZONE 'UTC'
WHERE pickup_at IS NULL AND date IS NOT NULL AND time IS NOT NULL;

CREATE INDEX IF NOT EXISTS jobs_company_pickup_idx ON public.jobs(company_id, pickup_at);
CREATE INDEX IF NOT EXISTS jobs_driver_idx ON public.jobs(driver_id);

-- ============ DRIVERS EXTENSIONS ============
ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS vehicle text;

-- ============ CLIENT_BOOKINGS EXTENSIONS ============
ALTER TABLE public.client_bookings
  ADD COLUMN IF NOT EXISTS pickup_at timestamptz,
  ADD COLUMN IF NOT EXISTS date date,
  ADD COLUMN IF NOT EXISTS job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS bookings_company_status_idx ON public.client_bookings(company_id, status);

-- ============ CLIENT_BOOKING_MODIFICATIONS ============
CREATE TABLE IF NOT EXISTS public.client_booking_modifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.client_bookings(id) ON DELETE CASCADE,
  requested_changes jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  requested_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_booking_modifications TO authenticated;
GRANT ALL ON public.client_booking_modifications TO service_role;
ALTER TABLE public.client_booking_modifications ENABLE ROW LEVEL SECURITY;

-- ============ MAGIC_LINKS ============
CREATE TABLE IF NOT EXISTS public.magic_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  kind public.magic_link_kind NOT NULL,
  subject_id uuid,
  subject_label text,
  token text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.magic_links TO authenticated;
GRANT SELECT ON public.magic_links TO anon;
GRANT ALL ON public.magic_links TO service_role;
ALTER TABLE public.magic_links ENABLE ROW LEVEL SECURITY;

-- ============ COORDINATOR INVITES ============
CREATE TABLE IF NOT EXISTS public.company_coordinator_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, email)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_coordinator_invites TO authenticated;
GRANT ALL ON public.company_coordinator_invites TO service_role;
ALTER TABLE public.company_coordinator_invites ENABLE ROW LEVEL SECURITY;

-- ============ TOPUP REQUESTS ============
CREATE TABLE IF NOT EXISTS public.topup_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL,
  points_requested integer NOT NULL CHECK (points_requested > 0),
  note text,
  status public.topup_request_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.topup_requests TO authenticated;
GRANT ALL ON public.topup_requests TO service_role;
ALTER TABLE public.topup_requests ENABLE ROW LEVEL SECURITY;

-- ============ HELPER ============
CREATE OR REPLACE FUNCTION public.is_company_owner(_user_id uuid, _company_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS(SELECT 1 FROM public.companies WHERE id = _company_id AND owner_user_id = _user_id);
$$;
REVOKE EXECUTE ON FUNCTION public.is_company_owner(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_company_owner(uuid, uuid) TO authenticated;

-- ============ RLS ============
DO $$ BEGIN CREATE POLICY "Company owners update own company" ON public.companies FOR UPDATE TO authenticated USING (owner_user_id = auth.uid()) WITH CHECK (owner_user_id = auth.uid()); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "Company owners manage jobs" ON public.jobs FOR ALL TO authenticated USING (public.is_company_owner(auth.uid(), company_id)) WITH CHECK (public.is_company_owner(auth.uid(), company_id)); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "Company owners manage pax" ON public.pax FOR ALL TO authenticated USING (EXISTS(SELECT 1 FROM public.jobs j WHERE j.id = pax.job_id AND public.is_company_owner(auth.uid(), j.company_id))) WITH CHECK (EXISTS(SELECT 1 FROM public.jobs j WHERE j.id = pax.job_id AND public.is_company_owner(auth.uid(), j.company_id))); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "Company owners manage groups" ON public.groups FOR ALL TO authenticated USING (EXISTS(SELECT 1 FROM public.jobs j WHERE j.id = groups.job_id AND public.is_company_owner(auth.uid(), j.company_id))) WITH CHECK (EXISTS(SELECT 1 FROM public.jobs j WHERE j.id = groups.job_id AND public.is_company_owner(auth.uid(), j.company_id))); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "Company owners manage drivers" ON public.drivers FOR ALL TO authenticated USING (public.is_company_owner(auth.uid(), company_id)) WITH CHECK (public.is_company_owner(auth.uid(), company_id)); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "Company owners read driver status" ON public.driver_status_updates FOR SELECT TO authenticated USING (EXISTS(SELECT 1 FROM public.drivers d WHERE d.id = driver_status_updates.driver_id AND public.is_company_owner(auth.uid(), d.company_id))); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "Company owners manage bookings" ON public.client_bookings FOR ALL TO authenticated USING (public.is_company_owner(auth.uid(), company_id)) WITH CHECK (public.is_company_owner(auth.uid(), company_id)); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "Company owners manage booking mods" ON public.client_booking_modifications FOR ALL TO authenticated USING (EXISTS(SELECT 1 FROM public.client_bookings b WHERE b.id = client_booking_modifications.booking_id AND public.is_company_owner(auth.uid(), b.company_id))) WITH CHECK (EXISTS(SELECT 1 FROM public.client_bookings b WHERE b.id = client_booking_modifications.booking_id AND public.is_company_owner(auth.uid(), b.company_id))); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "Admins manage booking mods" ON public.client_booking_modifications FOR ALL TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "Company owners manage magic links" ON public.magic_links FOR ALL TO authenticated USING (public.is_company_owner(auth.uid(), company_id)) WITH CHECK (public.is_company_owner(auth.uid(), company_id)); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "Admins manage magic links" ON public.magic_links FOR ALL TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "Anon can lookup active magic link" ON public.magic_links FOR SELECT TO anon USING (revoked_at IS NULL AND expires_at > now()); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "Admins manage invites" ON public.company_coordinator_invites FOR ALL TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "Company owners see own topups" ON public.topup_requests FOR SELECT TO authenticated USING (public.is_company_owner(auth.uid(), company_id)); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "Company owners insert own topups" ON public.topup_requests FOR INSERT TO authenticated WITH CHECK (public.is_company_owner(auth.uid(), company_id) AND requested_by = auth.uid()); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "Admins manage topups" ON public.topup_requests FOR ALL TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============ CHARGE FEATURE RPC ============
CREATE OR REPLACE FUNCTION public.charge_feature(
  _company_id uuid,
  _feature public.feature_name,
  _job_id uuid,
  _note text
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _cost integer; _bal integer;
BEGIN
  IF NOT (public.is_company_owner(auth.uid(), _company_id) OR public.is_admin(auth.uid())) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  SELECT points_cost INTO _cost FROM public.feature_costs WHERE feature_name = _feature;
  IF _cost IS NULL THEN _cost := 0; END IF;
  SELECT points_balance INTO _bal FROM public.companies WHERE id = _company_id FOR UPDATE;
  IF _bal IS NULL THEN RAISE EXCEPTION 'company_not_found'; END IF;
  IF _cost > 0 AND _bal < _cost THEN RAISE EXCEPTION 'insufficient_points'; END IF;
  IF _cost > 0 THEN
    UPDATE public.companies SET points_balance = _bal - _cost WHERE id = _company_id;
    _bal := _bal - _cost;
  END IF;
  INSERT INTO public.points_ledger (company_id, job_id, feature_used, points_deducted, note)
  VALUES (_company_id, _job_id, _feature, _cost, _note);
  RETURN _bal;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.charge_feature(uuid, public.feature_name, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.charge_feature(uuid, public.feature_name, uuid, text) TO authenticated;

-- ============ AUTH TRIGGER: link coordinator ============
CREATE OR REPLACE FUNCTION public.link_coordinator_on_signup()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.companies c
    SET owner_user_id = NEW.id
    FROM public.company_coordinator_invites i
    WHERE i.company_id = c.id
      AND lower(i.email) = lower(NEW.email)
      AND c.owner_user_id IS NULL;
  DELETE FROM public.company_coordinator_invites WHERE lower(email) = lower(NEW.email);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS link_coordinator_on_signup ON auth.users;
CREATE TRIGGER link_coordinator_on_signup AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.link_coordinator_on_signup();

-- ============ 2-HOUR RULE TRIGGER ============
CREATE OR REPLACE FUNCTION public.enforce_two_hour_rule()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE _diff interval;
BEGIN
  IF OLD.pickup_at IS NULL THEN RETURN NEW; END IF;
  _diff := OLD.pickup_at - now();
  IF _diff < interval '2 hours' AND _diff > interval '-24 hours' THEN
    IF NEW.status IS DISTINCT FROM OLD.status AND
       (NEW.from_location, NEW.to_location, NEW.pickup_at, NEW.time, NEW.date, NEW.room_number, NEW.name, NEW.surname)
       IS NOT DISTINCT FROM
       (OLD.from_location, OLD.to_location, OLD.pickup_at, OLD.time, OLD.date, OLD.room_number, OLD.name, OLD.surname) THEN
      RETURN NEW;
    END IF;
    INSERT INTO public.client_booking_modifications (booking_id, requested_changes)
    VALUES (OLD.id, jsonb_build_object(
      'from_location', NEW.from_location,
      'to_location', NEW.to_location,
      'pickup_at', NEW.pickup_at,
      'time', NEW.time,
      'date', NEW.date,
      'room_number', NEW.room_number,
      'name', NEW.name,
      'surname', NEW.surname
    ));
    UPDATE public.client_bookings SET status = 'modification_pending' WHERE id = OLD.id;
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS enforce_two_hour_rule ON public.client_bookings;
CREATE TRIGGER enforce_two_hour_rule BEFORE UPDATE ON public.client_bookings FOR EACH ROW EXECUTE FUNCTION public.enforce_two_hour_rule();

-- ============ SEED FEATURE COSTS ============
INSERT INTO public.feature_costs (feature_name, points_cost) VALUES
  ('magic_link_driver', 0),
  ('magic_link_client', 0),
  ('split_job', 0),
  ('clone_job', 0),
  ('recurring_schedule', 0)
ON CONFLICT (feature_name) DO NOTHING;

-- ============ updated_at triggers ============
DROP TRIGGER IF EXISTS set_updated_at ON public.magic_links;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.magic_links FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS set_updated_at ON public.topup_requests;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.topup_requests FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS set_updated_at ON public.client_booking_modifications;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.client_booking_modifications FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
