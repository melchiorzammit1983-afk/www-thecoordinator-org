ALTER TABLE public.trip_map_events DROP CONSTRAINT IF EXISTS trip_map_events_event_type_check;
ALTER TABLE public.trip_map_events
  ADD CONSTRAINT trip_map_events_event_type_check
  CHECK (event_type IN (
    'arrived_pickup','in_progress','completed',
    'pickup_snap','dropoff_snap',
    'actual_dropoff','emergency_override','safety_concern','breakdown',
    'en_route','back_to_waiting',
    'wait_started','wait_ended',
    'boarding_requested','boarding_approved',
    'pax_no_show','pax_cancelled',
    'navigate_opened','passenger_called'
  ));

NOTIFY pgrst, 'reload schema';