REVOKE EXECUTE ON FUNCTION public.driver_clear_payout(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.driver_mark_payout(uuid, numeric, text, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.match_ai_lessons(vector, uuid, text, integer) FROM anon, authenticated;