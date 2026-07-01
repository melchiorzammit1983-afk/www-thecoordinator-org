
DROP POLICY IF EXISTS "anyone can submit" ON public.access_requests;
CREATE POLICY "anyone can submit" ON public.access_requests
  FOR INSERT TO anon, authenticated
  WITH CHECK (length(trim(full_name)) > 1 AND email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');
