-- Client-managed people use the existing Operation Group member model.
-- These fields describe the person only; they never create or modify transport.
ALTER TABLE public.operation_group_members
  ADD COLUMN IF NOT EXISTS person_type text NOT NULL DEFAULT 'crew'
    CHECK (person_type IN ('crew', 'visitor')),
  ADD COLUMN IF NOT EXISTS organisation text,
  ADD COLUMN IF NOT EXISTS movement_type text NOT NULL DEFAULT 'other'
    CHECK (movement_type IN ('on_signing', 'off_signing', 'visitor', 'other')),
  ADD COLUMN IF NOT EXISTS flight_information text,
  ADD COLUMN IF NOT EXISTS hotel_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS transport_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS notes text;

ALTER TABLE public.operation_group_service_events
  DROP CONSTRAINT IF EXISTS operation_group_service_events_event_type_check;

ALTER TABLE public.operation_group_service_events
  ADD CONSTRAINT operation_group_service_events_event_type_check
  CHECK (event_type IN (
    'operation_created','member_added','member_updated','member_removed',
    'policy_saved','policy_approved','service_created','service_updated',
    'service_submitted','service_approved','change_requested',
    'service_confirmed','emergency_booked','emergency_acknowledged',
    'service_cancelled'
  ));

CREATE INDEX IF NOT EXISTS operation_group_members_people_idx
  ON public.operation_group_members (operation_group_id, person_type, active, created_at);
