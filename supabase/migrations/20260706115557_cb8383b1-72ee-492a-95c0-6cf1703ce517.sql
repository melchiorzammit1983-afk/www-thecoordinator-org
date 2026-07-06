
-- Coordinators can manage logos for their own portal companies
CREATE POLICY "coordinator can upload portal logos"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'portal-logos'
    AND EXISTS (
      SELECT 1 FROM public.portal_companies pc
      WHERE pc.id::text = split_part(name, '/', 1)
        AND (private.company_of(auth.uid()) = pc.coordinator_company_id OR private.is_admin(auth.uid()))
    )
  );

CREATE POLICY "coordinator can update portal logos"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'portal-logos'
    AND EXISTS (
      SELECT 1 FROM public.portal_companies pc
      WHERE pc.id::text = split_part(name, '/', 1)
        AND (private.company_of(auth.uid()) = pc.coordinator_company_id OR private.is_admin(auth.uid()))
    )
  );

CREATE POLICY "coordinator can delete portal logos"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'portal-logos'
    AND EXISTS (
      SELECT 1 FROM public.portal_companies pc
      WHERE pc.id::text = split_part(name, '/', 1)
        AND (private.company_of(auth.uid()) = pc.coordinator_company_id OR private.is_admin(auth.uid()))
    )
  );

-- Public read is allowed so the passenger tracking page (public route) can render the logo.
-- The bucket is private; only the specific portal-logos objects are readable, and they
-- contain no PII by definition (they are the hotel's own logo).
CREATE POLICY "anyone can read portal logos"
  ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'portal-logos');
