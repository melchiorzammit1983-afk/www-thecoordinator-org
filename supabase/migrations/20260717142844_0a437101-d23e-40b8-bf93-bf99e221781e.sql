
-- Add 'partial' to payment_status enum
ALTER TYPE public.payment_status ADD VALUE IF NOT EXISTS 'partial';
