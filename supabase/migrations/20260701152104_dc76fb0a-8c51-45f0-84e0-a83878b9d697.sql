
ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'external',
  ADD COLUMN IF NOT EXISTS linked_company_id uuid NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS linked_user_id uuid NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'drivers_kind_check') THEN
    ALTER TABLE public.drivers ADD CONSTRAINT drivers_kind_check
      CHECK (kind IN ('external','coordinator','partner'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS drivers_self_unique
  ON public.drivers(company_id) WHERE kind = 'coordinator';

CREATE UNIQUE INDEX IF NOT EXISTS drivers_partner_unique
  ON public.drivers(company_id, linked_company_id) WHERE kind = 'partner';
