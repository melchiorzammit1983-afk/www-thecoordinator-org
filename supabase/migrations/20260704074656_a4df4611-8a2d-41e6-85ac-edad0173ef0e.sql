ALTER TABLE public.client_bookings ADD COLUMN IF NOT EXISTS promo_note text;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS promo_note text;