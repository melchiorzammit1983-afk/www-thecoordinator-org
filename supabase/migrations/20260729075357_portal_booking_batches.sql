-- Phase 4 Round 3: group bulk-submitted portal bookings into a "batch" so the
-- company/agent can see and manage the set of rows they submitted together.
-- Portal-side concept only — deliberately NOT surfaced on the coordinator's
-- dispatch board (that stays exactly as it is today).

ALTER TABLE public.portal_bookings ADD COLUMN IF NOT EXISTS batch_id UUID;

CREATE INDEX IF NOT EXISTS idx_portal_bookings_batch ON public.portal_bookings(batch_id) WHERE batch_id IS NOT NULL;
