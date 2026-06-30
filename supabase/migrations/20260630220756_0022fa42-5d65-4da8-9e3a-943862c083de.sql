
-- =========================
-- ENUMS
-- =========================
CREATE TYPE public.company_status AS ENUM ('pending','approved','suspended');
CREATE TYPE public.job_status AS ENUM ('pending','active','completed');
CREATE TYPE public.pax_status AS ENUM ('pending','verified','onboard','delayed','noshow','completed');
CREATE TYPE public.group_status AS ENUM ('pending','assigned','active','completed');
CREATE TYPE public.driver_status AS ENUM ('available','busy','offline');
CREATE TYPE public.booking_status AS ENUM ('pending','accepted','rejected');
CREATE TYPE public.feature_name AS ENUM ('tracking','bulkupload','client_booking','qr');

-- =========================
-- UPDATED_AT helper
-- =========================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- =========================
-- ADMIN allow-list
-- =========================
CREATE TABLE public.admin_emails (
  email TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.admin_emails TO authenticated;
GRANT ALL ON public.admin_emails TO service_role;
ALTER TABLE public.admin_emails ENABLE ROW LEVEL SECURITY;
-- No policies for authenticated/anon: only SECURITY DEFINER fns + service role read it.

INSERT INTO public.admin_emails (email) VALUES ('melchior.zammit@outlook.com');

CREATE OR REPLACE FUNCTION public.is_admin(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM auth.users u
    JOIN public.admin_emails a ON lower(a.email) = lower(u.email)
    WHERE u.id = _user_id
  );
$$;

-- =========================
-- COMPANIES
-- =========================
CREATE TABLE public.companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  access_end TIMESTAMPTZ,
  points_balance INTEGER NOT NULL DEFAULT 0,
  custom_link TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24),'hex'),
  require_client_company BOOLEAN NOT NULL DEFAULT true,
  status public.company_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.companies TO authenticated;
GRANT ALL ON public.companies TO service_role;
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all companies"
  ON public.companies FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Company owners read own company"
  ON public.companies FOR SELECT TO authenticated
  USING (owner_user_id = auth.uid());

CREATE TRIGGER trg_companies_updated_at
  BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================
-- FEATURE COSTS
-- =========================
CREATE TABLE public.feature_costs (
  feature_name public.feature_name PRIMARY KEY,
  points_cost INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.feature_costs TO authenticated;
GRANT ALL ON public.feature_costs TO service_role;
ALTER TABLE public.feature_costs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage feature costs"
  ON public.feature_costs FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Authenticated read feature costs"
  ON public.feature_costs FOR SELECT TO authenticated
  USING (true);

CREATE TRIGGER trg_feature_costs_updated_at
  BEFORE UPDATE ON public.feature_costs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.feature_costs (feature_name, points_cost) VALUES
  ('tracking', 0),
  ('bulkupload', 0),
  ('client_booking', 0),
  ('qr', 0);

-- =========================
-- JOBS
-- =========================
CREATE TABLE public.jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  clientcompanyname TEXT,
  from_location TEXT NOT NULL,
  to_location TEXT NOT NULL,
  date DATE NOT NULL,
  time TIME NOT NULL,
  flightorship TEXT,
  tracking_enabled BOOLEAN NOT NULL DEFAULT false,
  status public.job_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.jobs TO authenticated;
GRANT ALL ON public.jobs TO service_role;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage jobs"
  ON public.jobs FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Company owners read own jobs"
  ON public.jobs FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.companies c
    WHERE c.id = jobs.company_id AND c.owner_user_id = auth.uid()
  ));

CREATE TRIGGER trg_jobs_updated_at
  BEFORE UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================
-- GROUPS
-- =========================
CREATE TABLE public.groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  driver_id UUID,
  driver_link TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24),'hex'),
  meetandgreet_sign TEXT,
  coordinator_note TEXT,
  status public.group_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.groups TO authenticated;
GRANT ALL ON public.groups TO service_role;
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage groups"
  ON public.groups FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE TRIGGER trg_groups_updated_at
  BEFORE UPDATE ON public.groups
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================
-- DRIVERS
-- =========================
CREATE TABLE public.drivers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  status public.driver_status NOT NULL DEFAULT 'offline',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.drivers TO authenticated;
GRANT ALL ON public.drivers TO service_role;
ALTER TABLE public.drivers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage drivers"
  ON public.drivers FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE TRIGGER trg_drivers_updated_at
  BEFORE UPDATE ON public.drivers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Now that drivers exists, add FK from groups.driver_id
ALTER TABLE public.groups
  ADD CONSTRAINT groups_driver_id_fkey FOREIGN KEY (driver_id)
  REFERENCES public.drivers(id) ON DELETE SET NULL;

-- =========================
-- PAX
-- =========================
CREATE TABLE public.pax (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  group_id UUID REFERENCES public.groups(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  status public.pax_status NOT NULL DEFAULT 'pending',
  qr_code TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24),'hex'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pax TO authenticated;
GRANT ALL ON public.pax TO service_role;
ALTER TABLE public.pax ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage pax"
  ON public.pax FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE TRIGGER trg_pax_updated_at
  BEFORE UPDATE ON public.pax
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================
-- CLIENT BOOKINGS
-- =========================
CREATE TABLE public.client_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  surname TEXT NOT NULL,
  client_email TEXT NOT NULL,
  room_number TEXT,
  from_location TEXT NOT NULL,
  to_location TEXT NOT NULL,
  time TIME NOT NULL,
  status public.booking_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_bookings TO authenticated;
GRANT INSERT ON public.client_bookings TO anon;
GRANT ALL ON public.client_bookings TO service_role;
ALTER TABLE public.client_bookings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage bookings"
  ON public.client_bookings FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Company owners read own bookings"
  ON public.client_bookings FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.companies c
    WHERE c.id = client_bookings.company_id AND c.owner_user_id = auth.uid()
  ));

-- Public link: anyone can insert a booking ONLY if the target company is approved.
CREATE POLICY "Public insert booking for approved company"
  ON public.client_bookings FOR INSERT TO anon
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.companies c
    WHERE c.id = client_bookings.company_id AND c.status = 'approved'
  ));

CREATE TRIGGER trg_client_bookings_updated_at
  BEFORE UPDATE ON public.client_bookings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================
-- POINTS LEDGER
-- =========================
-- Positive points_deducted = points spent. Negative = top-up.
CREATE TABLE public.points_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  job_id UUID REFERENCES public.jobs(id) ON DELETE SET NULL,
  feature_used public.feature_name,
  points_deducted INTEGER NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.points_ledger TO authenticated;
GRANT ALL ON public.points_ledger TO service_role;
ALTER TABLE public.points_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage ledger"
  ON public.points_ledger FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Company owners read own ledger"
  ON public.points_ledger FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.companies c
    WHERE c.id = points_ledger.company_id AND c.owner_user_id = auth.uid()
  ));

-- =========================
-- DRIVER STATUS UPDATES
-- =========================
CREATE TABLE public.driver_status_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  location_lat DOUBLE PRECISION NOT NULL,
  location_lng DOUBLE PRECISION NOT NULL,
  estimated_eta TIME,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.driver_status_updates TO authenticated;
GRANT ALL ON public.driver_status_updates TO service_role;
ALTER TABLE public.driver_status_updates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage driver status"
  ON public.driver_status_updates FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));
