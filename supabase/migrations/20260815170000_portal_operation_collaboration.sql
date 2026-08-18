-- Portal-linked Operation Groups with two-sided approvals, hotel holds, and
-- client-approved emergency spending authority. All writes are server-only.

ALTER TABLE public.portal_link_events
  DROP CONSTRAINT IF EXISTS portal_link_events_actor_kind_check;
ALTER TABLE public.portal_link_events
  ADD CONSTRAINT portal_link_events_actor_kind_check
  CHECK (actor_kind IN ('coordinator','client','portal','hotel','admin','system'));

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS portal_subdomain text;
ALTER TABLE public.companies
  DROP CONSTRAINT IF EXISTS companies_portal_subdomain_format_check;
ALTER TABLE public.companies
  ADD CONSTRAINT companies_portal_subdomain_format_check
  CHECK (
    portal_subdomain IS NULL OR
    portal_subdomain ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'
  );
CREATE UNIQUE INDEX IF NOT EXISTS companies_portal_subdomain_unique_idx
  ON public.companies (lower(portal_subdomain))
  WHERE portal_subdomain IS NOT NULL;

ALTER TABLE public.portal_companies
  ADD COLUMN IF NOT EXISTS client_slug text;
ALTER TABLE public.portal_companies
  DROP CONSTRAINT IF EXISTS portal_companies_client_slug_format_check;
ALTER TABLE public.portal_companies
  ADD CONSTRAINT portal_companies_client_slug_format_check
  CHECK (
    client_slug IS NULL OR
    client_slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'
  );
CREATE UNIQUE INDEX IF NOT EXISTS portal_companies_company_client_slug_unique_idx
  ON public.portal_companies (coordinator_company_id, lower(client_slug))
  WHERE client_slug IS NOT NULL;

ALTER TABLE public.operation_groups
  ADD COLUMN IF NOT EXISTS portal_company_id uuid
    REFERENCES public.portal_companies(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS crew_count integer NOT NULL DEFAULT 0
    CHECK (crew_count BETWEEN 0 AND 10000),
  ADD COLUMN IF NOT EXISTS visitor_count integer NOT NULL DEFAULT 0
    CHECK (visitor_count BETWEEN 0 AND 10000),
  ADD COLUMN IF NOT EXISTS created_by_side text NOT NULL DEFAULT 'coordinator'
    CHECK (created_by_side IN ('coordinator', 'client'));

CREATE INDEX IF NOT EXISTS operation_groups_portal_company_idx
  ON public.operation_groups (portal_company_id, status, start_date)
  WHERE portal_company_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.operation_group_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_group_id uuid NOT NULL
    REFERENCES public.operation_groups(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  portal_company_id uuid NOT NULL
    REFERENCES public.portal_companies(id) ON DELETE RESTRICT,
  side text NOT NULL CHECK (side IN ('coordinator', 'client')),
  role text NOT NULL CHECK (role IN (
    'lead_coordinator', 'operations_member', 'coordinator_approver',
    'client_editor', 'client_approver', 'client_viewer', 'driver'
  )),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 160),
  email text,
  is_primary_approver boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS operation_group_members_group_idx
  ON public.operation_group_members (operation_group_id, active, side);
CREATE UNIQUE INDEX IF NOT EXISTS operation_group_members_primary_side_idx
  ON public.operation_group_members (operation_group_id, side)
  WHERE active AND is_primary_approver;
CREATE UNIQUE INDEX IF NOT EXISTS operation_group_members_email_idx
  ON public.operation_group_members (operation_group_id, lower(email))
  WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.operation_group_emergency_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_company_id uuid NOT NULL UNIQUE
    REFERENCES public.portal_companies(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  enabled boolean NOT NULL DEFAULT false,
  currency text NOT NULL DEFAULT 'EUR'
    CHECK (currency ~ '^[A-Z]{3}$'),
  per_booking_limit numeric(12,2) NOT NULL DEFAULT 0
    CHECK (per_booking_limit >= 0),
  per_operation_limit numeric(12,2) NOT NULL DEFAULT 0
    CHECK (per_operation_limit >= per_booking_limit),
  allowed_service_types text[] NOT NULL DEFAULT ARRAY['hotel','transfer']::text[],
  starts_at timestamptz,
  ends_at timestamptz,
  supporting_document_required boolean NOT NULL DEFAULT true,
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  client_approved_revision integer,
  client_approved_by text,
  client_approved_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at),
  CHECK (client_approved_revision IS NULL OR client_approved_revision <= revision),
  CHECK (allowed_service_types <@ ARRAY[
    'flight','hotel','transfer','driver','meet_greet','visitor','document','other'
  ]::text[])
);

CREATE TABLE IF NOT EXISTS public.operation_group_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_group_id uuid NOT NULL
    REFERENCES public.operation_groups(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  portal_company_id uuid NOT NULL
    REFERENCES public.portal_companies(id) ON DELETE RESTRICT,
  service_type text NOT NULL CHECK (service_type IN (
    'flight','hotel','transfer','driver','meet_greet','visitor','document','other'
  )),
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  provider text,
  location_name text,
  location_address text,
  location_place_id text,
  location_lat numeric,
  location_lng numeric,
  starts_at timestamptz,
  ends_at timestamptz,
  notes text,
  amount numeric(12,2) CHECK (amount IS NULL OR amount >= 0),
  currency text NOT NULL DEFAULT 'EUR' CHECK (currency ~ '^[A-Z]{3}$'),
  booking_state text NOT NULL DEFAULT 'draft' CHECK (booking_state IN (
    'draft','on_hold','confirmed','cancelled'
  )),
  hold_expires_at timestamptz,
  approval_status text NOT NULL DEFAULT 'draft' CHECK (approval_status IN (
    'draft','awaiting_client','awaiting_coordinator','approved_by_both','change_requested'
  )),
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_by_side text NOT NULL CHECK (created_by_side IN ('coordinator','client')),
  created_by_name text NOT NULL CHECK (char_length(btrim(created_by_name)) BETWEEN 1 AND 160),
  coordinator_approved_revision integer,
  coordinator_approved_by text,
  coordinator_approved_at timestamptz,
  client_approved_revision integer,
  client_approved_by text,
  client_approved_at timestamptz,
  change_requested_by_side text CHECK (change_requested_by_side IN ('coordinator','client')),
  change_request_reason text,
  emergency_policy_id uuid
    REFERENCES public.operation_group_emergency_policies(id) ON DELETE RESTRICT,
  emergency_reason text,
  confirmation_reference text,
  supporting_document_reference text,
  client_acknowledged_by text,
  client_acknowledged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at >= starts_at),
  CHECK (booking_state <> 'on_hold' OR hold_expires_at IS NOT NULL),
  CHECK (coordinator_approved_revision IS NULL OR coordinator_approved_revision <= revision),
  CHECK (client_approved_revision IS NULL OR client_approved_revision <= revision)
);

CREATE INDEX IF NOT EXISTS operation_group_services_group_idx
  ON public.operation_group_services (operation_group_id, approval_status, starts_at);
CREATE INDEX IF NOT EXISTS operation_group_services_portal_idx
  ON public.operation_group_services (portal_company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS operation_group_services_hold_idx
  ON public.operation_group_services (hold_expires_at)
  WHERE booking_state = 'on_hold';

CREATE TABLE IF NOT EXISTS public.operation_group_service_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_group_id uuid NOT NULL
    REFERENCES public.operation_groups(id) ON DELETE CASCADE,
  service_id uuid REFERENCES public.operation_group_services(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  portal_company_id uuid NOT NULL
    REFERENCES public.portal_companies(id) ON DELETE RESTRICT,
  actor_side text NOT NULL CHECK (actor_side IN ('coordinator','client','system')),
  actor_name text NOT NULL CHECK (char_length(btrim(actor_name)) BETWEEN 1 AND 160),
  event_type text NOT NULL CHECK (event_type IN (
    'operation_created','member_added','policy_saved','policy_approved',
    'service_created','service_updated','service_submitted','service_approved',
    'change_requested','service_confirmed','emergency_booked','emergency_acknowledged',
    'service_cancelled'
  )),
  service_revision integer,
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS operation_group_service_events_group_idx
  ON public.operation_group_service_events (operation_group_id, created_at DESC);
CREATE INDEX IF NOT EXISTS operation_group_service_events_service_idx
  ON public.operation_group_service_events (service_id, created_at DESC)
  WHERE service_id IS NOT NULL;

-- A portal-linked group or policy must belong to the company that owns that
-- client portal. Legacy non-portal Operation Groups remain valid with NULL.
CREATE OR REPLACE FUNCTION public.validate_portal_operation_root_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  portal_coordinator_company_id uuid;
BEGIN
  IF NEW.portal_company_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT coordinator_company_id
    INTO portal_coordinator_company_id
    FROM public.portal_companies
   WHERE id = NEW.portal_company_id;

  IF portal_coordinator_company_id IS NULL
     OR portal_coordinator_company_id <> NEW.company_id THEN
    RAISE EXCEPTION 'Portal company does not belong to the Operation Group company';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_portal_operation_root_scope()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_operation_groups_portal_scope
  ON public.operation_groups;
CREATE TRIGGER trg_operation_groups_portal_scope
  BEFORE INSERT OR UPDATE OF company_id, portal_company_id
  ON public.operation_groups
  FOR EACH ROW EXECUTE FUNCTION public.validate_portal_operation_root_scope();

DROP TRIGGER IF EXISTS trg_operation_group_policies_portal_scope
  ON public.operation_group_emergency_policies;
CREATE TRIGGER trg_operation_group_policies_portal_scope
  BEFORE INSERT OR UPDATE OF company_id, portal_company_id
  ON public.operation_group_emergency_policies
  FOR EACH ROW EXECUTE FUNCTION public.validate_portal_operation_root_scope();

-- Portal children must always use the same coordinator company and client
-- portal as their parent Operation Group. This protects service-role writes
-- from accidental cross-tenant linkage.
CREATE OR REPLACE FUNCTION public.validate_portal_operation_child_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  group_company_id uuid;
  group_portal_company_id uuid;
BEGIN
  SELECT company_id, portal_company_id
    INTO group_company_id, group_portal_company_id
    FROM public.operation_groups
   WHERE id = NEW.operation_group_id;

  IF group_company_id IS NULL
     OR group_company_id <> NEW.company_id
     OR group_portal_company_id IS NULL
     OR group_portal_company_id <> NEW.portal_company_id THEN
    RAISE EXCEPTION 'Portal Operation Group scope mismatch';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_portal_operation_child_scope()
  FROM PUBLIC, anon, authenticated;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'operation_group_members',
    'operation_group_services',
    'operation_group_service_events'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$I_scope ON public.%1$I', table_name);
    EXECUTE format(
      'CREATE TRIGGER trg_%1$I_scope BEFORE INSERT OR UPDATE OF operation_group_id, company_id, portal_company_id ON public.%1$I FOR EACH ROW EXECUTE FUNCTION public.validate_portal_operation_child_scope()',
      table_name
    );
  END LOOP;
END;
$$;

DROP TRIGGER IF EXISTS trg_operation_group_members_touch_updated_at
  ON public.operation_group_members;
CREATE TRIGGER trg_operation_group_members_touch_updated_at
  BEFORE UPDATE ON public.operation_group_members
  FOR EACH ROW EXECUTE FUNCTION public.touch_transport_updated_at();

DROP TRIGGER IF EXISTS trg_operation_group_policies_touch_updated_at
  ON public.operation_group_emergency_policies;
CREATE TRIGGER trg_operation_group_policies_touch_updated_at
  BEFORE UPDATE ON public.operation_group_emergency_policies
  FOR EACH ROW EXECUTE FUNCTION public.touch_transport_updated_at();

DROP TRIGGER IF EXISTS trg_operation_group_services_touch_updated_at
  ON public.operation_group_services;
CREATE TRIGGER trg_operation_group_services_touch_updated_at
  BEFORE UPDATE ON public.operation_group_services
  FOR EACH ROW EXECUTE FUNCTION public.touch_transport_updated_at();

ALTER TABLE public.operation_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operation_group_emergency_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operation_group_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operation_group_service_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.operation_group_members
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.operation_group_emergency_policies
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.operation_group_services
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.operation_group_service_events
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON TABLE public.operation_group_members
  FROM service_role;
REVOKE ALL ON TABLE public.operation_group_emergency_policies
  FROM service_role;
REVOKE ALL ON TABLE public.operation_group_services
  FROM service_role;
REVOKE ALL ON TABLE public.operation_group_service_events
  FROM service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.operation_group_members
  TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.operation_group_emergency_policies
  TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.operation_group_services
  TO service_role;
GRANT SELECT, INSERT ON TABLE public.operation_group_service_events
  TO service_role;

COMMENT ON TABLE public.operation_group_services IS
  'Revisioned client/coordinator service drafts with two-sided approval and booking state.';
COMMENT ON TABLE public.operation_group_emergency_policies IS
  'Client-approved standing authority for urgent coordinator bookings within fixed limits.';
COMMENT ON TABLE public.operation_group_service_events IS
  'Append-only audit history for portal-linked Operation Group collaboration.';
