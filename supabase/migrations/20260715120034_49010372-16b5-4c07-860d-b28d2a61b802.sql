REVOKE EXECUTE ON FUNCTION public.audit_boarding_approvals_trg() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.audit_emergency_overrides_trg() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.audit_jobs_status_trg() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.audit_pax_trg() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.audit_wait_sessions_trg() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_trip_audit(uuid, text, jsonb, jsonb, text, numeric, numeric, numeric, text, numeric, timestamptz, uuid, uuid, text, uuid, text) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.verify_trip_audit_chain(uuid) FROM anon, authenticated, PUBLIC;