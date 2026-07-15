
DROP POLICY IF EXISTS "override_photos_read_by_company" ON storage.objects;
CREATE POLICY "override_photos_read_by_company"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'override-photos'
    AND split_part(objects.name, '/', 1) = private.company_of(auth.uid())::text
  );

DROP POLICY IF EXISTS "override_photos_service_write" ON storage.objects;
CREATE POLICY "override_photos_service_write"
  ON storage.objects FOR INSERT TO service_role
  WITH CHECK (bucket_id = 'override-photos');
