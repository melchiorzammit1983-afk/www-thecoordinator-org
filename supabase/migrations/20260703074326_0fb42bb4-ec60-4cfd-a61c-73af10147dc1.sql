
-- Revoke EXECUTE from public/anon/authenticated on all SECURITY DEFINER functions,
-- then re-grant only where actually needed. Trigger-only functions get no grants.

-- Trigger functions (invoked by the DB, never by clients)
DO $$
DECLARE fn text;
BEGIN
  FOR fn IN SELECT unnest(ARRAY[
    'validate_public_client_booking()',
    'auto_approve_coordinator_jobs()',
    'sync_driver_external()',
    'enforce_two_hour_rule()',
    'set_updated_at()',
    'link_coordinator_on_signup()',
    'enforce_company_owner_update()',
    'enforce_hop_immutable_fields()',
    'enforce_jobs_partner_update()',
    'enforce_driver_self_update()',
    'enforce_driver_assign_by_executor()',
    'enforce_single_admin()'
  ]) LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', fn);
  END LOOP;
END $$;

-- Public token-based RPCs: callable by anon (via public portals) and authenticated
REVOKE ALL ON FUNCTION public.driver_save_profile(text, text, text, text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.driver_save_profile(text, text, text, text, text, integer) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.driver_accept_job(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.driver_accept_job(text, uuid) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.driver_approve_deletion(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.driver_approve_deletion(text, uuid) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.lookup_magic_link(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lookup_magic_link(text) TO anon, authenticated;

-- Coordinator RPCs: authenticated only (revoke anon)
REVOKE ALL ON FUNCTION public.dispatch_job_forward(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dispatch_job_forward(uuid, uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.respond_dispatch(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_dispatch(uuid, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.charge_feature(uuid, feature_name, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.charge_feature(uuid, feature_name, uuid, text) TO authenticated;

-- RLS helper functions: needed by policies evaluated as anon/authenticated
REVOKE ALL ON FUNCTION public.is_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.is_company_owner(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_company_owner(uuid, uuid) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.company_of(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.company_of(uuid) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.has_connection_permission(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_connection_permission(uuid, uuid, text) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.is_executor_of(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_executor_of(uuid, uuid) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.job_in_my_chain(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.job_in_my_chain(uuid) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.has_feature(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_feature(uuid, text) TO anon, authenticated;
