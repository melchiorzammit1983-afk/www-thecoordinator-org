
-- 1) Magic link token exposure: replace anon SELECT policy with a token-scoped RPC.
DROP POLICY IF EXISTS "Anon can lookup active magic link" ON public.magic_links;

CREATE OR REPLACE FUNCTION public.lookup_magic_link(_token text)
RETURNS TABLE (
  id uuid,
  company_id uuid,
  kind text,
  subject_id uuid,
  subject_label text,
  expires_at timestamptz,
  revoked_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.id, m.company_id, m.kind::text, m.subject_id, m.subject_label, m.expires_at, m.revoked_at
  FROM public.magic_links m
  WHERE m.token = _token
    AND m.revoked_at IS NULL
    AND (m.expires_at IS NULL OR m.expires_at > now())
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.lookup_magic_link(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lookup_magic_link(text) TO anon, authenticated, service_role;

-- 2) driver_status_updates: allow the linked driver user to insert their own updates.
CREATE POLICY "Drivers insert own status" ON public.driver_status_updates
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.drivers d
      WHERE d.id = driver_status_updates.driver_id
        AND d.linked_user_id = auth.uid()
    )
  );

CREATE POLICY "Drivers read own status" ON public.driver_status_updates
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.drivers d
      WHERE d.id = driver_status_updates.driver_id
        AND d.linked_user_id = auth.uid()
    )
  );

-- 3) job_labels: ensure trip_label company matches job company.
DROP POLICY IF EXISTS job_labels_company_write ON public.job_labels;
CREATE POLICY job_labels_company_write ON public.job_labels
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.id = job_labels.job_id
        AND (public.is_company_owner(auth.uid(), j.company_id) OR public.is_admin(auth.uid()))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.jobs j
      JOIN public.trip_labels tl ON tl.id = job_labels.label_id
      WHERE j.id = job_labels.job_id
        AND tl.company_id = j.company_id
        AND (public.is_company_owner(auth.uid(), j.company_id) OR public.is_admin(auth.uid()))
    )
  );

-- 4) Lock down SECURITY DEFINER function execute privileges.
REVOKE EXECUTE ON FUNCTION public.driver_accept_job(text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.driver_approve_deletion(text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.dispatch_job_forward(uuid, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.respond_dispatch(uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.job_in_my_chain(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enforce_driver_assign_by_executor() FROM PUBLIC;

-- Callers on the server use service_role (bypasses grants) or authenticated user context.
GRANT EXECUTE ON FUNCTION public.dispatch_job_forward(uuid, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.respond_dispatch(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.driver_accept_job(text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.driver_approve_deletion(text, uuid) TO service_role;
-- job_in_my_chain is only used inside RLS policies where SECURITY DEFINER runs regardless of grants.
GRANT EXECUTE ON FUNCTION public.job_in_my_chain(uuid) TO service_role;
-- enforce_driver_assign_by_executor runs only as a trigger; no role needs EXECUTE.
