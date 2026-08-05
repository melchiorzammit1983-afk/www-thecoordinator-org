-- Ship Operations 21B: lifecycle timestamps and statuses.
-- Existing rows remain valid with nullable lifecycle timestamps.
ALTER TABLE public.ship_events
  ADD COLUMN IF NOT EXISTS expected_departure timestamptz,
  ADD COLUMN IF NOT EXISTS actual_arrival timestamptz,
  ADD COLUMN IF NOT EXISTS actual_departure timestamptz;

ALTER TABLE public.ship_events
  DROP CONSTRAINT IF EXISTS ship_events_status_check;

ALTER TABLE public.ship_events
  ADD CONSTRAINT ship_events_status_check
  CHECK (status IN ('scheduled', 'arrived', 'departed', 'archived', 'cancelled'));

UPDATE public.ship_events
SET status = 'archived'
WHERE archived_at IS NOT NULL AND status <> 'archived';

CREATE INDEX IF NOT EXISTS ship_events_company_lifecycle_idx
  ON public.ship_events (company_id, status, eta);