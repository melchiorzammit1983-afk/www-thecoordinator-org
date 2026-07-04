-- Add referral code to companies for referral tracking.
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS referral_code text
    UNIQUE
    DEFAULT lower(encode(extensions.gen_random_bytes(6), 'hex'));

-- Backfill any existing rows that came in before the default.
UPDATE public.companies
   SET referral_code = lower(encode(extensions.gen_random_bytes(6), 'hex'))
 WHERE referral_code IS NULL;

ALTER TABLE public.companies
  ALTER COLUMN referral_code SET NOT NULL;

CREATE INDEX IF NOT EXISTS companies_referral_code_idx
  ON public.companies (referral_code);