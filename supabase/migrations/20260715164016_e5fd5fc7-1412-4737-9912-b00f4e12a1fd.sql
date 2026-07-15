
DROP POLICY IF EXISTS "anyone authenticated can read portal settings" ON public.admin_portal_settings;

CREATE POLICY "admins can read portal settings" ON public.admin_portal_settings
  FOR SELECT TO authenticated
  USING (private.is_admin(auth.uid()));
