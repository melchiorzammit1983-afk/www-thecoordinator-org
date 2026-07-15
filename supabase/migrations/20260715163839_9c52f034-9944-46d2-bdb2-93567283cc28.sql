
-- Make write-restrictions explicit for client_locations (writes only via service_role/server functions)
CREATE POLICY "no client-side writes on client_locations" ON public.client_locations
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

COMMENT ON TABLE public.client_locations IS
  'Passenger live-location pings. Writes are inserted exclusively by server functions using the admin client after validating a pax tracking token. No anon/authenticated write path exists.';

-- Make the anon-no-access intent explicit on pax_tracking_tokens
CREATE POLICY "no anon access on pax_tracking_tokens" ON public.pax_tracking_tokens
  AS RESTRICTIVE FOR ALL TO anon
  USING (false) WITH CHECK (false);

COMMENT ON TABLE public.pax_tracking_tokens IS
  'Passenger tracking tokens. Anonymous callers must go through /api/public/track/* server routes which validate the token via the admin client. Direct anon SELECT is denied by RLS and by the absence of a Data API grant.';
