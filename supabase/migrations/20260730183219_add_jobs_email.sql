-- Bulk-paste template restructure: a trip-level contact email, mirroring
-- the existing contact_phone column, so the bulk grid and Excel/Sheets
-- template can carry an email alongside the phone number.
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS email text;

COMMENT ON COLUMN public.jobs.email IS
  'Trip contact email, entered via the bulk-paste grid or Excel/Sheets template — mirrors contact_phone.';
