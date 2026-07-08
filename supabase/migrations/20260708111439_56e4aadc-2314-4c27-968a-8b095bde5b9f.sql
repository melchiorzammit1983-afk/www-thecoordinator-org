
-- 1. client_bookings: add DB-level length CHECK constraints to complement existing validation trigger
ALTER TABLE public.client_bookings
  ADD CONSTRAINT client_bookings_name_len CHECK (name IS NULL OR char_length(name) BETWEEN 1 AND 80),
  ADD CONSTRAINT client_bookings_surname_len CHECK (surname IS NULL OR char_length(surname) BETWEEN 1 AND 80),
  ADD CONSTRAINT client_bookings_email_fmt CHECK (client_email IS NULL OR (char_length(client_email) BETWEEN 3 AND 200 AND client_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  ADD CONSTRAINT client_bookings_from_len CHECK (from_location IS NULL OR char_length(from_location) BETWEEN 1 AND 200),
  ADD CONSTRAINT client_bookings_to_len CHECK (to_location IS NULL OR char_length(to_location) BETWEEN 1 AND 200),
  ADD CONSTRAINT client_bookings_room_len CHECK (room_number IS NULL OR char_length(room_number) <= 40);

-- 2. password_reset_requests: add explicit deny INSERT policy for anon/authenticated (service_role bypasses RLS)
CREATE POLICY "no direct inserts"
  ON public.password_reset_requests
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (false);

-- 3. storage.objects: tighten portal-logos public SELECT to only files whose top-level path segment
-- matches an existing portal_companies.id
DROP POLICY IF EXISTS "anyone can read portal logos" ON storage.objects;
CREATE POLICY "anyone can read portal logos"
  ON storage.objects
  FOR SELECT
  TO anon, authenticated
  USING (
    bucket_id = 'portal-logos'
    AND EXISTS (
      SELECT 1 FROM public.portal_companies pc
      WHERE pc.id::text = split_part(storage.objects.name, '/', 1)
    )
  );

-- 4. job_labels: strengthen USING on write policy to also verify the label belongs to the same company as the job
DROP POLICY IF EXISTS job_labels_company_write ON public.job_labels;
CREATE POLICY job_labels_company_write
  ON public.job_labels
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.jobs j
      JOIN public.trip_labels tl ON tl.id = job_labels.label_id
      WHERE j.id = job_labels.job_id
        AND tl.company_id = j.company_id
        AND (private.is_company_owner(auth.uid(), j.company_id) OR private.is_admin(auth.uid()))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.jobs j
      JOIN public.trip_labels tl ON tl.id = job_labels.label_id
      WHERE j.id = job_labels.job_id
        AND tl.company_id = j.company_id
        AND (private.is_company_owner(auth.uid(), j.company_id) OR private.is_admin(auth.uid()))
    )
  );
