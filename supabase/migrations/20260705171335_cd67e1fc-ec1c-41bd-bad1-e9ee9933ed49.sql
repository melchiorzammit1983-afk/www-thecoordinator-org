ALTER TABLE public.driver_locations
  ADD COLUMN IF NOT EXISTS eta_sec integer,
  ADD COLUMN IF NOT EXISTS distance_m integer,
  ADD COLUMN IF NOT EXISTS next_instruction text,
  ADD COLUMN IF NOT EXISTS destination_label text;