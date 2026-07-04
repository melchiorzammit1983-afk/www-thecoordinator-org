
REVOKE ALL ON FUNCTION public.spend_points(uuid, text, uuid, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_grant_points(uuid, integer, text)       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_company_plan(uuid, uuid)                  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rollover_subscriptions()                      FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.spend_points(uuid, text, uuid, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_grant_points(uuid, integer, text)       TO service_role;
GRANT EXECUTE ON FUNCTION public.set_company_plan(uuid, uuid)                  TO service_role;
GRANT EXECUTE ON FUNCTION public.rollover_subscriptions()                      TO service_role;
