-- Restrict portal-logos storage policies to the `authenticated` role only.
DROP POLICY IF EXISTS "coordinator can read portal logos" ON storage.objects;
DROP POLICY IF EXISTS "coordinator can upload portal logos" ON storage.objects;
DROP POLICY IF EXISTS "coordinator can update portal logos" ON storage.objects;
DROP POLICY IF EXISTS "coordinator can delete portal logos" ON storage.objects;

CREATE POLICY "coordinator can read portal logos"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'portal-logos'
    AND EXISTS (
      SELECT 1 FROM public.portal_companies pc
      WHERE pc.id::text = (storage.foldername(objects.name))[1]
        AND (private.company_of(auth.uid()) = pc.coordinator_company_id OR private.is_admin(auth.uid()))
    )
  );

CREATE POLICY "coordinator can upload portal logos"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'portal-logos'
    AND EXISTS (
      SELECT 1 FROM public.portal_companies pc
      WHERE pc.id::text = (storage.foldername(objects.name))[1]
        AND pc.coordinator_company_id = private.company_of(auth.uid())
    )
  );

CREATE POLICY "coordinator can update portal logos"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'portal-logos'
    AND EXISTS (
      SELECT 1 FROM public.portal_companies pc
      WHERE pc.id::text = (storage.foldername(objects.name))[1]
        AND (private.company_of(auth.uid()) = pc.coordinator_company_id OR private.is_admin(auth.uid()))
    )
  )
  WITH CHECK (
    bucket_id = 'portal-logos'
    AND EXISTS (
      SELECT 1 FROM public.portal_companies pc
      WHERE pc.id::text = (storage.foldername(objects.name))[1]
        AND (private.company_of(auth.uid()) = pc.coordinator_company_id OR private.is_admin(auth.uid()))
    )
  );

CREATE POLICY "coordinator can delete portal logos"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'portal-logos'
    AND EXISTS (
      SELECT 1 FROM public.portal_companies pc
      WHERE pc.id::text = (storage.foldername(objects.name))[1]
        AND (private.company_of(auth.uid()) = pc.coordinator_company_id OR private.is_admin(auth.uid()))
    )
  );
