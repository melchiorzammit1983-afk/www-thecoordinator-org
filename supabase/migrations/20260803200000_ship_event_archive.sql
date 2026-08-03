-- Ship events are operational occurrences. Archive them instead of deleting so
-- historical Jobs/Trips and ETA history remain valid and traceable.
ALTER TABLE public.ship_events
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ship_events_company_active_eta_idx
  ON public.ship_events (company_id, eta)
  WHERE archived_at IS NULL;
