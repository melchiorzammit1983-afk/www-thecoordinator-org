
-- 1) client_bookings: add validation trigger for anon inserts, force default status, cap field lengths
CREATE OR REPLACE FUNCTION public.validate_public_client_booking()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Only enforce for anon/unauthenticated inserts (public booking form).
  IF auth.uid() IS NULL THEN
    -- Force safe defaults for server-controlled fields
    NEW.status := 'pending'::booking_status;

    -- Basic presence + length limits
    IF length(coalesce(NEW.name,'')) = 0 OR length(NEW.name) > 80 THEN
      RAISE EXCEPTION 'invalid_name';
    END IF;
    IF length(coalesce(NEW.surname,'')) = 0 OR length(NEW.surname) > 80 THEN
      RAISE EXCEPTION 'invalid_surname';
    END IF;
    IF length(coalesce(NEW.client_email,'')) = 0 OR length(NEW.client_email) > 200
       OR NEW.client_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
      RAISE EXCEPTION 'invalid_email';
    END IF;
    IF length(coalesce(NEW.from_location,'')) = 0 OR length(NEW.from_location) > 200 THEN
      RAISE EXCEPTION 'invalid_from_location';
    END IF;
    IF length(coalesce(NEW.to_location,'')) = 0 OR length(NEW.to_location) > 200 THEN
      RAISE EXCEPTION 'invalid_to_location';
    END IF;
    IF NEW.room_number IS NOT NULL AND length(NEW.room_number) > 40 THEN
      RAISE EXCEPTION 'invalid_room_number';
    END IF;
    IF NEW.pickup_at IS NOT NULL AND NEW.pickup_at < now() - interval '1 day' THEN
      RAISE EXCEPTION 'invalid_pickup_at';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_public_client_booking ON public.client_bookings;
CREATE TRIGGER trg_validate_public_client_booking
BEFORE INSERT ON public.client_bookings
FOR EACH ROW EXECUTE FUNCTION public.validate_public_client_booking();


-- 2) driver_locations: add self-scoped policies via drivers.linked_user_id
CREATE POLICY "Driver reads own locations"
ON public.driver_locations
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.drivers d
    WHERE d.id = driver_locations.driver_id
      AND d.linked_user_id = auth.uid()
  )
);

CREATE POLICY "Driver inserts own locations"
ON public.driver_locations
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.drivers d
    WHERE d.id = driver_locations.driver_id
      AND d.linked_user_id = auth.uid()
  )
);

CREATE POLICY "Driver updates own locations"
ON public.driver_locations
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.drivers d
    WHERE d.id = driver_locations.driver_id
      AND d.linked_user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.drivers d
    WHERE d.id = driver_locations.driver_id
      AND d.linked_user_id = auth.uid()
  )
);


-- 3) pax: drop obsolete qr_code column (QR verification was removed earlier)
ALTER TABLE public.pax DROP COLUMN IF EXISTS qr_code;
