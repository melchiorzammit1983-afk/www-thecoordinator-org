
CREATE POLICY "block all authenticated" ON public.client_link_identities
  FOR ALL TO authenticated USING (false) WITH CHECK (false);
