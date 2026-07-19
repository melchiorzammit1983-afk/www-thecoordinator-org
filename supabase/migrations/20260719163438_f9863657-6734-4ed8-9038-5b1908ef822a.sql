
-- 1. override-photos: allow company owners to update/delete their own photos
CREATE POLICY "override_photos_update_by_company" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'override-photos' AND split_part(name, '/', 1) = (private.company_of(auth.uid()))::text)
  WITH CHECK (bucket_id = 'override-photos' AND split_part(name, '/', 1) = (private.company_of(auth.uid()))::text);

CREATE POLICY "override_photos_delete_by_company" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'override-photos' AND split_part(name, '/', 1) = (private.company_of(auth.uid()))::text);

-- 2. portal-media: ownership-scoped policies matching portal-logos pattern (files stored under <portal_company_id>/...)
CREATE POLICY "coordinator can read portal media" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'portal-media' AND EXISTS (
      SELECT 1 FROM public.portal_companies pc
      WHERE pc.id::text = (storage.foldername(objects.name))[1]
        AND (private.company_of(auth.uid()) = pc.coordinator_company_id OR private.is_admin(auth.uid()))
    )
  );

CREATE POLICY "coordinator can upload portal media" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'portal-media' AND EXISTS (
      SELECT 1 FROM public.portal_companies pc
      WHERE pc.id::text = (storage.foldername(objects.name))[1]
        AND pc.coordinator_company_id = private.company_of(auth.uid())
    )
  );

CREATE POLICY "coordinator can update portal media" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'portal-media' AND EXISTS (
      SELECT 1 FROM public.portal_companies pc
      WHERE pc.id::text = (storage.foldername(objects.name))[1]
        AND (private.company_of(auth.uid()) = pc.coordinator_company_id OR private.is_admin(auth.uid()))
    )
  )
  WITH CHECK (
    bucket_id = 'portal-media' AND EXISTS (
      SELECT 1 FROM public.portal_companies pc
      WHERE pc.id::text = (storage.foldername(objects.name))[1]
        AND (private.company_of(auth.uid()) = pc.coordinator_company_id OR private.is_admin(auth.uid()))
    )
  );

CREATE POLICY "coordinator can delete portal media" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'portal-media' AND EXISTS (
      SELECT 1 FROM public.portal_companies pc
      WHERE pc.id::text = (storage.foldername(objects.name))[1]
        AND (private.company_of(auth.uid()) = pc.coordinator_company_id OR private.is_admin(auth.uid()))
    )
  );
