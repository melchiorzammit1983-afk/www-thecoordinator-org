
CREATE TABLE IF NOT EXISTS public.admin_activity_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid,
  actor_email   text,
  actor_label   text,
  action        text NOT NULL,
  table_name    text NOT NULL,
  row_id        text,
  company_id    uuid,
  changed_keys  text[],
  before_data   jsonb,
  after_data    jsonb
);

GRANT SELECT ON public.admin_activity_log TO authenticated;
GRANT ALL ON public.admin_activity_log TO service_role;

ALTER TABLE public.admin_activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read activity log"
  ON public.admin_activity_log FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.admin_emails ae
      JOIN auth.users u ON lower(u.email) = lower(ae.email)
      WHERE u.id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS admin_activity_log_created_at_idx
  ON public.admin_activity_log (created_at DESC);
CREATE INDEX IF NOT EXISTS admin_activity_log_actor_idx
  ON public.admin_activity_log (actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_activity_log_table_idx
  ON public.admin_activity_log (table_name, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_activity_log_company_idx
  ON public.admin_activity_log (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_activity_log_row_idx
  ON public.admin_activity_log (table_name, row_id);

CREATE OR REPLACE FUNCTION public.log_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_label text;
  v_row_id text;
  v_company uuid;
  v_before jsonb;
  v_after jsonb;
  v_changed text[] := ARRAY[]::text[];
  k text;
  v_is_admin boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    v_label := 'public/token';
  ELSE
    BEGIN
      SELECT email INTO v_email FROM auth.users WHERE id = v_uid;
    EXCEPTION WHEN OTHERS THEN
      v_email := NULL;
    END;
    IF v_email IS NOT NULL THEN
      SELECT EXISTS(SELECT 1 FROM public.admin_emails ae WHERE lower(ae.email) = lower(v_email))
        INTO v_is_admin;
    END IF;
    v_label := CASE WHEN v_is_admin THEN 'admin' ELSE 'coordinator' END;
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_before := to_jsonb(OLD);
    v_after := NULL;
  ELSIF TG_OP = 'INSERT' THEN
    v_before := NULL;
    v_after := to_jsonb(NEW);
  ELSE
    v_before := to_jsonb(OLD);
    v_after := to_jsonb(NEW);
    FOR k IN SELECT jsonb_object_keys(v_after) LOOP
      IF (v_after -> k) IS DISTINCT FROM (v_before -> k) THEN
        v_changed := v_changed || k;
      END IF;
    END LOOP;
    IF array_length(v_changed, 1) IS NULL THEN
      RETURN NEW;
    END IF;
  END IF;

  v_row_id := COALESCE( (COALESCE(v_after, v_before) ->> 'id'), NULL );
  BEGIN
    v_company := NULLIF( COALESCE( (COALESCE(v_after, v_before) ->> 'company_id'), '' ), '' )::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_company := NULL;
  END;

  INSERT INTO public.admin_activity_log(
    actor_user_id, actor_email, actor_label, action, table_name, row_id,
    company_id, changed_keys, before_data, after_data
  ) VALUES (
    v_uid, v_email, v_label, TG_OP, TG_TABLE_NAME, v_row_id, v_company,
    CASE WHEN array_length(v_changed,1) IS NULL THEN NULL ELSE v_changed END,
    v_before, v_after
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'jobs','job_price_proposals','job_dispatch_hops','job_labels','trip_labels',
    'pax','drivers','driver_status_updates','companies','company_coordinator_invites',
    'company_feature_entitlements','coordinator_connections','connection_invites',
    'client_bookings','client_booking_modifications','client_link_identities',
    'client_sos_events','groups','points_ledger','topup_requests','admin_emails',
    'access_requests','feature_costs','trip_messages','magic_links'
  ];
BEGIN
  FOR t IN SELECT DISTINCT unnest(tables) LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=t) THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_log_activity ON public.%I', t);
      EXECUTE format(
        'CREATE TRIGGER trg_log_activity AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.log_activity()', t
      );
    END IF;
  END LOOP;
END $$;
