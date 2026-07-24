-- Keep the current on-duty contact separate from both the permanent network
-- phone (companies.phone) and the coordinator login phone
-- (companies.coordinator_phone). Client links read this value live so a duty
-- handover updates every active link immediately.
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS operations_phone text;

COMMENT ON COLUMN public.companies.operations_phone IS
  'Current 24/7 on-duty operations contact shown on client-facing trip links.';

-- Personal passenger links use the last four digits of pax.phone for their
-- protected chat/location verification step. Keep the token in sync whenever
-- a passenger is created or their phone changes.
CREATE OR REPLACE FUNCTION public.ensure_pax_tracking_token()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  phone_digits text;
  last_four text;
BEGIN
  phone_digits := regexp_replace(COALESCE(NEW.phone, ''), '[^0-9]', '', 'g');
  last_four := CASE
    WHEN length(phone_digits) >= 4 THEN right(phone_digits, 4)
    ELSE NULL
  END;

  -- A new passenger gets a personal link. A phone edit must never resurrect a
  -- link that the coordinator deliberately revoked.
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.pax_tracking_tokens (job_id, pax_id, phone_last4)
    VALUES (NEW.job_id, NEW.id, last_four)
    ON CONFLICT DO NOTHING;
  END IF;

  UPDATE public.pax_tracking_tokens
     SET phone_last4 = last_four
   WHERE pax_id = NEW.id
     AND revoked_at IS NULL;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_pax_tracking_token() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_pax_ensure_token ON public.pax;
CREATE TRIGGER trg_pax_ensure_token
  AFTER INSERT OR UPDATE OF phone ON public.pax
  FOR EACH ROW EXECUTE FUNCTION public.ensure_pax_tracking_token();

-- Repair personal links created before passenger phones were synchronized.
UPDATE public.pax_tracking_tokens AS token
   SET phone_last4 = CASE
     WHEN length(regexp_replace(COALESCE(passenger.phone, ''), '[^0-9]', '', 'g')) >= 4
       THEN right(regexp_replace(passenger.phone, '[^0-9]', '', 'g'), 4)
     ELSE NULL
   END
  FROM public.pax AS passenger
 WHERE token.pax_id = passenger.id
   AND token.revoked_at IS NULL;
