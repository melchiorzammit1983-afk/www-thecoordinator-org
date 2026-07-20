DROP POLICY IF EXISTS "Public insert booking for approved company" ON public.client_bookings;
REVOKE INSERT ON public.client_bookings FROM anon;