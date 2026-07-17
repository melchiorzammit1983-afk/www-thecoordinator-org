
DROP POLICY IF EXISTS "coordinator can read portal logos" ON storage.objects;
DROP POLICY IF EXISTS "coordinator can upload portal logos" ON storage.objects;
DROP POLICY IF EXISTS "coordinator can update portal logos" ON storage.objects;
DROP POLICY IF EXISTS "coordinator can delete portal logos" ON storage.objects;

CREATE POLICY "coordinator can read portal logos" ON storage.objects
FOR SELECT USING (
  bucket_id = 'portal-logos'
  AND EXISTS (
    SELECT 1 FROM public.portal_companies pc
    WHERE pc.id::text = (storage.foldername(storage.objects.name))[1]
      AND (private.company_of(auth.uid()) = pc.coordinator_company_id OR private.is_admin(auth.uid()))
  )
);

CREATE POLICY "coordinator can upload portal logos" ON storage.objects
FOR INSERT WITH CHECK (
  bucket_id = 'portal-logos'
  AND EXISTS (
    SELECT 1 FROM public.portal_companies pc
    WHERE pc.id::text = (storage.foldername(storage.objects.name))[1]
      AND pc.coordinator_company_id = private.company_of(auth.uid())
  )
);

CREATE POLICY "coordinator can update portal logos" ON storage.objects
FOR UPDATE USING (
  bucket_id = 'portal-logos'
  AND EXISTS (
    SELECT 1 FROM public.portal_companies pc
    WHERE pc.id::text = (storage.foldername(storage.objects.name))[1]
      AND (private.company_of(auth.uid()) = pc.coordinator_company_id OR private.is_admin(auth.uid()))
  )
) WITH CHECK (
  bucket_id = 'portal-logos'
  AND EXISTS (
    SELECT 1 FROM public.portal_companies pc
    WHERE pc.id::text = (storage.foldername(storage.objects.name))[1]
      AND (private.company_of(auth.uid()) = pc.coordinator_company_id OR private.is_admin(auth.uid()))
  )
);

CREATE POLICY "coordinator can delete portal logos" ON storage.objects
FOR DELETE USING (
  bucket_id = 'portal-logos'
  AND EXISTS (
    SELECT 1 FROM public.portal_companies pc
    WHERE pc.id::text = (storage.foldername(storage.objects.name))[1]
      AND (private.company_of(auth.uid()) = pc.coordinator_company_id OR private.is_admin(auth.uid()))
  )
);
