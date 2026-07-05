
-- Set fixed search_path on pgmq wrapper functions
ALTER FUNCTION public.enqueue_email(text, jsonb) SET search_path = public;
ALTER FUNCTION public.read_email_batch(text, integer, integer) SET search_path = public;
ALTER FUNCTION public.delete_email(text, bigint) SET search_path = public;
ALTER FUNCTION public.move_to_dlq(text, text, bigint, jsonb) SET search_path = public;

-- Revoke EXECUTE from public/anon/authenticated on SECURITY DEFINER functions
-- that must not be callable directly by clients. Keep service_role.
DO $$
DECLARE
  fn text;
  fns text[] := ARRAY[
    'admin_grant_points(uuid, numeric, text)',
    'auto_assign_job(uuid)',
    'delete_email(text, bigint)',
    'email_queue_dispatch()',
    'email_queue_wake()',
    'enforce_driver_assign_by_executor()',
    'enqueue_email(text, jsonb)',
    'link_coordinator_on_signup()',
    'log_activity()',
    'move_to_dlq(text, text, bigint, jsonb)',
    'read_email_batch(text, integer, integer)',
    'rollover_subscriptions()',
    'set_company_plan(uuid, uuid)',
    'spend_points(uuid, text, uuid, text, numeric)'
  ];
BEGIN
  FOREACH fn IN ARRAY fns LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
  END LOOP;
END $$;
