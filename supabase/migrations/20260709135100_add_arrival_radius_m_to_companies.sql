-- Per-company configurable GPS arrival radius.
-- NULL means "use the application default" (DEFAULT_ARRIVAL_RADIUS_M = 150 m).
-- A future admin UI can set this to a tighter value (e.g. 50 m for a hotel drop).
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS arrival_radius_m integer NULL;
