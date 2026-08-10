-- Milestone 26 / Stage 3: recipient-scoped Portal access.
-- Tokens are stored only as SHA-256 hashes; external access uses server functions.

CREATE TABLE public.portal_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_id uuid NOT NULL REFERENCES public.portals(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  recipient_company text NOT NULL CHECK (char_length(btrim(recipient_company)) BETWEEN 1 AND 160),
  recipient_name text NOT NULL CHECK (char_length(btrim(recipient_name)) BETWEEN 1 AND 160),
  contact_display_name text,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz,
  revoked_at timestamptz,
  disabled_at timestamptz,
  last_accessed_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX portal_recipients_portal_idx ON public.portal_recipients (portal_id, created_at DESC);
CREATE INDEX portal_recipients_company_idx ON public.portal_recipients (company_id);

CREATE TABLE public.portal_recipient_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_recipient_id uuid NOT NULL REFERENCES public.portal_recipients(id) ON DELETE RESTRICT,
  portal_id uuid NOT NULL REFERENCES public.portals(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('issued', 'accessed', 'revoked', 'disabled', 'reactivated')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX portal_recipient_activity_recipient_idx ON public.portal_recipient_activity (portal_recipient_id, created_at DESC);

ALTER TABLE public.portal_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_recipient_activity ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.portal_recipients TO service_role;
GRANT ALL ON public.portal_recipient_activity TO service_role;

CREATE POLICY "Company owners manage portal recipients"
  ON public.portal_recipients FOR ALL TO authenticated
  USING (private.is_company_owner(auth.uid(), company_id) OR private.is_admin(auth.uid()))
  WITH CHECK (private.is_company_owner(auth.uid(), company_id) OR private.is_admin(auth.uid()));
CREATE POLICY "Company owners view portal recipient activity"
  ON public.portal_recipient_activity FOR SELECT TO authenticated
  USING (private.is_company_owner(auth.uid(), company_id) OR private.is_admin(auth.uid()));
