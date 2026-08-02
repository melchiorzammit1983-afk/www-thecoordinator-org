ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS default_departure_pickup_offset_minutes integer NOT NULL DEFAULT 180,
  ADD COLUMN IF NOT EXISTS default_arrival_pickup_offset_minutes integer NOT NULL DEFAULT 45;