
ALTER TABLE public.trip_map_events DROP CONSTRAINT IF EXISTS trip_map_events_event_type_check;
ALTER TABLE public.trip_map_events ADD CONSTRAINT trip_map_events_event_type_check
  CHECK (event_type = ANY (ARRAY[
    'arrived_pickup','in_progress','completed','pickup_snap','dropoff_snap',
    'actual_dropoff','emergency_override','safety_concern','breakdown',
    'en_route','back_to_waiting','wait_started','wait_ended',
    'boarding_requested','boarding_approved','boarding_rejected',
    'pax_no_show','pax_cancelled','navigate_opened','passenger_called',
    'status_corrected','arrived_pickup_override'
  ]::text[]));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'trip_map_events'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.trip_map_events';
  END IF;
END $$;

ALTER TABLE public.trip_map_events REPLICA IDENTITY FULL;
