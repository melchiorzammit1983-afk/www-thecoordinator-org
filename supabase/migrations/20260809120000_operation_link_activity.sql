-- Milestone 25 / Stage 4: immutable audit trail for external updates.
CREATE TABLE public.operation_link_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_link_id uuid NOT NULL REFERENCES public.operation_links(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  operation_group_id uuid NOT NULL REFERENCES public.operation_groups(id) ON DELETE RESTRICT,
  action_type text NOT NULL CHECK (action_type IN ('eta_updated', 'departure_updated', 'port_change_requested', 'operational_update_submitted')),
  previous_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  new_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX operation_link_activity_group_idx ON public.operation_link_activity(operation_group_id, created_at DESC);
CREATE INDEX operation_link_activity_link_idx ON public.operation_link_activity(operation_link_id, created_at DESC);
ALTER TABLE public.operation_link_activity ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.operation_link_activity TO service_role;
REVOKE ALL ON public.operation_link_activity FROM PUBLIC, anon, authenticated;
