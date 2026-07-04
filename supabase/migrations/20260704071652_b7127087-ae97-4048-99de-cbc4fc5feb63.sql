
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS logo_url text,
  ADD COLUMN IF NOT EXISTS advert_url text,
  ADD COLUMN IF NOT EXISTS advert_link text,
  ADD COLUMN IF NOT EXISTS advert_caption text,
  ADD COLUMN IF NOT EXISTS advert_enabled boolean NOT NULL DEFAULT false;
