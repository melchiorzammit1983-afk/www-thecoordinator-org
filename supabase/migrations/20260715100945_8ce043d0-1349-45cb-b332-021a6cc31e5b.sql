
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS safety_mode_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS safety_mode_allow_override boolean NOT NULL DEFAULT true;

ALTER TABLE public.job_emergency_overrides
  ADD COLUMN IF NOT EXISTS photo_url text,
  ADD COLUMN IF NOT EXISTS photo_path text,
  ADD COLUMN IF NOT EXISTS gps_lat double precision,
  ADD COLUMN IF NOT EXISTS gps_lng double precision,
  ADD COLUMN IF NOT EXISTS gps_accuracy_m double precision,
  ADD COLUMN IF NOT EXISTS street_address text,
  ADD COLUMN IF NOT EXISTS vehicle_label text,
  ADD COLUMN IF NOT EXISTS pax_count integer;

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS safety_flag_at timestamptz,
  ADD COLUMN IF NOT EXISTS breakdown_flag_at timestamptz;

DROP POLICY IF EXISTS "coordinator can upload portal logos" ON storage.objects;
CREATE POLICY "coordinator can upload portal logos"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'portal-logos'
    AND EXISTS (
      SELECT 1 FROM public.portal_companies pc
      WHERE pc.coordinator_company_id = private.company_of(auth.uid())
        AND split_part(objects.name, '/', 1) = pc.id::text
    )
  );
