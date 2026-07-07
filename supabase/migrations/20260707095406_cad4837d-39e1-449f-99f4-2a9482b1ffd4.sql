CREATE TABLE public.password_reset_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  phone TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

GRANT SELECT, UPDATE ON public.password_reset_requests TO authenticated;
GRANT ALL ON public.password_reset_requests TO service_role;

ALTER TABLE public.password_reset_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins can view" ON public.password_reset_requests
  FOR SELECT TO authenticated USING (private.is_admin(auth.uid()));

CREATE POLICY "admins can update" ON public.password_reset_requests
  FOR UPDATE TO authenticated USING (private.is_admin(auth.uid()));

CREATE INDEX password_reset_requests_created_at_idx
  ON public.password_reset_requests (created_at DESC);

CREATE INDEX password_reset_requests_status_idx
  ON public.password_reset_requests (status);