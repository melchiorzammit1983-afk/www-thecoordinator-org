
CREATE TABLE public.access_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  company_name TEXT,
  role TEXT,
  country TEXT,
  fleet_size TEXT,
  message TEXT,
  referral_code TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT INSERT ON public.access_requests TO anon, authenticated;
GRANT SELECT, UPDATE, DELETE ON public.access_requests TO authenticated;
GRANT ALL ON public.access_requests TO service_role;
ALTER TABLE public.access_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anyone can submit" ON public.access_requests FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "admins can view" ON public.access_requests FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "admins can update" ON public.access_requests FOR UPDATE TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "admins can delete" ON public.access_requests FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));
CREATE INDEX access_requests_created_at_idx ON public.access_requests (created_at DESC);
CREATE INDEX access_requests_referral_idx ON public.access_requests (referral_code);
