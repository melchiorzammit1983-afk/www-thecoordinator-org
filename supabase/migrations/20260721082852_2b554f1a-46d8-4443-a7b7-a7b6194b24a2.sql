
-- Phase 1: Passenger phone/note + per-passenger tracking tokens

-- 1. Extend pax with optional contact + note
ALTER TABLE public.pax
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS note  text;

-- 2. Add pax_id FK to pax_tracking_tokens so each passenger owns a personal link.
--    Nullable to preserve backward compat with existing per-job tokens.
ALTER TABLE public.pax_tracking_tokens
  ADD COLUMN IF NOT EXISTS pax_id uuid REFERENCES public.pax(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_pax_tokens_pax ON public.pax_tracking_tokens(pax_id);

-- Ensure a passenger has at most one live tracking token
CREATE UNIQUE INDEX IF NOT EXISTS uq_pax_tokens_pax_active
  ON public.pax_tracking_tokens(pax_id)
  WHERE pax_id IS NOT NULL AND revoked_at IS NULL;

-- 3. Auto-mint a personal tracking token whenever a pax row is inserted.
CREATE OR REPLACE FUNCTION public.ensure_pax_tracking_token()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.pax_tracking_tokens (job_id, pax_id)
  VALUES (NEW.job_id, NEW.id)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pax_ensure_token ON public.pax;
CREATE TRIGGER trg_pax_ensure_token
  AFTER INSERT ON public.pax
  FOR EACH ROW EXECUTE FUNCTION public.ensure_pax_tracking_token();

-- 4. Backfill personal tokens for existing pax that don't have one yet.
INSERT INTO public.pax_tracking_tokens (job_id, pax_id)
SELECT p.job_id, p.id
  FROM public.pax p
  LEFT JOIN public.pax_tracking_tokens t
    ON t.pax_id = p.id AND t.revoked_at IS NULL
 WHERE t.id IS NULL;
