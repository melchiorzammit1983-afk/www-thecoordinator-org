-- Rebuild pickup_at from (date, time) treating them as Europe/Malta local time.
-- Historical rows were written with the wall-clock stamped as UTC, which drifts
-- by the Malta offset on driver/client screens.

UPDATE public.jobs
SET pickup_at = ((date::text || ' ' || time::text)::timestamp AT TIME ZONE 'Europe/Malta')
WHERE date IS NOT NULL AND time IS NOT NULL;

UPDATE public.client_bookings
SET pickup_at = ((date::text || ' ' || time::text)::timestamp AT TIME ZONE 'Europe/Malta')
WHERE date IS NOT NULL AND time IS NOT NULL;