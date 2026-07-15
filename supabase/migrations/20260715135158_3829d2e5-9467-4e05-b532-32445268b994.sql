
-- ============================================================
-- push_devices
-- ============================================================
CREATE TABLE public.push_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  role text NOT NULL CHECK (role IN ('driver','client','coordinator','admin')),
  platform text NOT NULL CHECK (platform IN ('web','android','ios')),
  token text,
  endpoint text,
  p256dh text,
  auth text,
  user_agent text,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, token),
  UNIQUE (user_id, endpoint)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_devices TO authenticated;
GRANT ALL ON public.push_devices TO service_role;

ALTER TABLE public.push_devices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "push_devices_owner_select" ON public.push_devices
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "push_devices_owner_insert" ON public.push_devices
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "push_devices_owner_update" ON public.push_devices
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "push_devices_owner_delete" ON public.push_devices
  FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE INDEX push_devices_user_idx ON public.push_devices(user_id);
CREATE INDEX push_devices_company_role_idx ON public.push_devices(company_id, role);

-- ============================================================
-- notification_preferences
-- ============================================================
CREATE TABLE public.notification_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  new_job boolean NOT NULL DEFAULT true,
  job_updated boolean NOT NULL DEFAULT true,
  boarding boolean NOT NULL DEFAULT true,
  safety boolean NOT NULL DEFAULT true,
  chat boolean NOT NULL DEFAULT true,
  route_optimization boolean NOT NULL DEFAULT true,
  waiting boolean NOT NULL DEFAULT true,
  driver_status boolean NOT NULL DEFAULT true,
  trip_lifecycle boolean NOT NULL DEFAULT true,
  security boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_preferences TO authenticated;
GRANT ALL ON public.notification_preferences TO service_role;

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notif_prefs_owner_all" ON public.notification_preferences
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ============================================================
-- notification_log
-- ============================================================
CREATE TABLE public.notification_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  device_id uuid REFERENCES public.push_devices(id) ON DELETE SET NULL,
  category text NOT NULL,
  title text NOT NULL,
  body text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  sent_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  clicked_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.notification_log TO authenticated;
GRANT ALL ON public.notification_log TO service_role;

ALTER TABLE public.notification_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notif_log_owner_select" ON public.notification_log
  FOR SELECT TO authenticated USING (user_id = auth.uid());
-- delivery/click updates by owner (from client on push click)
CREATE POLICY "notif_log_owner_update" ON public.notification_log
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE INDEX notification_log_user_idx ON public.notification_log(user_id, created_at DESC);
CREATE INDEX notification_log_company_idx ON public.notification_log(company_id, created_at DESC);

-- ============================================================
-- user_security_settings
-- ============================================================
CREATE TABLE public.user_security_settings (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  biometric_enabled boolean NOT NULL DEFAULT false,
  require_biometric_on_open boolean NOT NULL DEFAULT true,
  auto_lock_seconds integer NOT NULL DEFAULT 60 CHECK (auto_lock_seconds >= 0 AND auto_lock_seconds <= 3600),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_security_settings TO authenticated;
GRANT ALL ON public.user_security_settings TO service_role;

ALTER TABLE public.user_security_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_security_owner_all" ON public.user_security_settings
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ============================================================
-- webauthn_credentials
-- ============================================================
CREATE TABLE public.webauthn_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  credential_id text NOT NULL UNIQUE,
  public_key text NOT NULL,
  sign_count bigint NOT NULL DEFAULT 0,
  transports text[] NOT NULL DEFAULT ARRAY[]::text[],
  device_label text,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.webauthn_credentials TO authenticated;
GRANT ALL ON public.webauthn_credentials TO service_role;

ALTER TABLE public.webauthn_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "webauthn_owner_select" ON public.webauthn_credentials
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "webauthn_owner_delete" ON public.webauthn_credentials
  FOR DELETE TO authenticated USING (user_id = auth.uid());
-- inserts/updates go through server functions using service_role

CREATE INDEX webauthn_user_idx ON public.webauthn_credentials(user_id);

-- ============================================================
-- updated_at triggers
-- ============================================================
CREATE TRIGGER push_devices_updated_at BEFORE UPDATE ON public.push_devices
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER notif_prefs_updated_at BEFORE UPDATE ON public.notification_preferences
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER user_security_updated_at BEFORE UPDATE ON public.user_security_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
