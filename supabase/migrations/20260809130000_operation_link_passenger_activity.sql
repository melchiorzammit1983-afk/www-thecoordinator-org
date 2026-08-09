-- Add the Stage 5 passenger audit action without changing the already-applied
-- Operation Link activity migration.
ALTER TABLE public.operation_link_activity
  DROP CONSTRAINT IF EXISTS operation_link_activity_action_type_check;

ALTER TABLE public.operation_link_activity
  ADD CONSTRAINT operation_link_activity_action_type_check
  CHECK (action_type IN (
    'eta_updated',
    'departure_updated',
    'port_change_requested',
    'passenger_onboard_updated',
    'operational_update_submitted'
  ));
