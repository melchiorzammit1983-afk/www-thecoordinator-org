-- ============ Extend portal_companies ============
ALTER TABLE public.portal_companies
  ADD COLUMN IF NOT EXISTS pricing_mode text NOT NULL DEFAULT 'coordinator'
    CHECK (pricing_mode IN ('coordinator','hotel','hotel_markup')),
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'EUR';

-- ============ Rooms ============
CREATE TABLE IF NOT EXISTS public.portal_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_company_id uuid NOT NULL REFERENCES public.portal_companies(id) ON DELETE CASCADE,
  room_number text NOT NULL,
  label text,
  qr_token text NOT NULL DEFAULT encode(extensions.gen_random_bytes(18), 'hex'),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (portal_company_id, room_number),
  UNIQUE (qr_token)
);
CREATE INDEX IF NOT EXISTS idx_portal_rooms_portal ON public.portal_rooms(portal_company_id);
GRANT ALL ON public.portal_rooms TO service_role;
ALTER TABLE public.portal_rooms ENABLE ROW LEVEL SECURITY;
-- No policies: Data API access is denied; server-side (admin client) only.

-- ============ Guest sessions ============
CREATE TABLE IF NOT EXISTS public.portal_guest_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_company_id uuid NOT NULL REFERENCES public.portal_companies(id) ON DELETE CASCADE,
  room_id uuid REFERENCES public.portal_rooms(id) ON DELETE SET NULL,
  guest_name text NOT NULL,
  email text,
  phone text,
  session_token text NOT NULL DEFAULT encode(extensions.gen_random_bytes(24), 'hex'),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_token)
);
CREATE INDEX IF NOT EXISTS idx_portal_guest_sessions_portal ON public.portal_guest_sessions(portal_company_id);
CREATE INDEX IF NOT EXISTS idx_portal_guest_sessions_room ON public.portal_guest_sessions(room_id);
GRANT ALL ON public.portal_guest_sessions TO service_role;
ALTER TABLE public.portal_guest_sessions ENABLE ROW LEVEL SECURITY;

-- ============ Zones + fares ============
CREATE TABLE IF NOT EXISTS public.portal_zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_company_id uuid NOT NULL REFERENCES public.portal_companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_portal_zones_portal ON public.portal_zones(portal_company_id);
GRANT ALL ON public.portal_zones TO service_role;
ALTER TABLE public.portal_zones ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.portal_zone_fares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id uuid NOT NULL REFERENCES public.portal_zones(id) ON DELETE CASCADE,
  pax_tier text NOT NULL DEFAULT '1-3',
  price numeric(10,2) NOT NULL,
  coordinator_base_price numeric(10,2),
  markup numeric(10,2),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (zone_id, pax_tier)
);
CREATE INDEX IF NOT EXISTS idx_portal_zone_fares_zone ON public.portal_zone_fares(zone_id);
GRANT ALL ON public.portal_zone_fares TO service_role;
ALTER TABLE public.portal_zone_fares ENABLE ROW LEVEL SECURITY;

-- ============ Promos ============
CREATE TABLE IF NOT EXISTS public.portal_promos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_company_id uuid NOT NULL REFERENCES public.portal_companies(id) ON DELETE CASCADE,
  code text NOT NULL,
  kind text NOT NULL DEFAULT 'percent' CHECK (kind IN ('percent','amount')),
  value numeric(10,2) NOT NULL,
  min_price numeric(10,2),
  applies_to text NOT NULL DEFAULT 'transport' CHECK (applies_to IN ('transport','offers','both')),
  starts_at timestamptz,
  ends_at timestamptz,
  max_uses int,
  uses_count int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (portal_company_id, code)
);
CREATE INDEX IF NOT EXISTS idx_portal_promos_portal ON public.portal_promos(portal_company_id);
GRANT ALL ON public.portal_promos TO service_role;
ALTER TABLE public.portal_promos ENABLE ROW LEVEL SECURITY;

-- ============ Add-ons + Offers ============
CREATE TABLE IF NOT EXISTS public.portal_addons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_company_id uuid NOT NULL REFERENCES public.portal_companies(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  price numeric(10,2),
  category text,
  image_url text,
  active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_portal_addons_portal ON public.portal_addons(portal_company_id);
GRANT ALL ON public.portal_addons TO service_role;
ALTER TABLE public.portal_addons ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.portal_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_company_id uuid NOT NULL REFERENCES public.portal_companies(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  image_url text,
  price numeric(10,2),
  cta_label text,
  cta_url text,
  sort_order int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_portal_offers_portal ON public.portal_offers(portal_company_id);
GRANT ALL ON public.portal_offers TO service_role;
ALTER TABLE public.portal_offers ENABLE ROW LEVEL SECURITY;

-- ============ Extend portal_bookings ============
ALTER TABLE public.portal_bookings
  ADD COLUMN IF NOT EXISTS fare_breakdown jsonb,
  ADD COLUMN IF NOT EXISTS promo_code text,
  ADD COLUMN IF NOT EXISTS addon_selections jsonb,
  ADD COLUMN IF NOT EXISTS guest_session_id uuid REFERENCES public.portal_guest_sessions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS zone_id uuid REFERENCES public.portal_zones(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS room_id uuid REFERENCES public.portal_rooms(id) ON DELETE SET NULL;

-- ============ updated_at triggers ============
CREATE OR REPLACE FUNCTION public.portal_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['portal_rooms','portal_zones','portal_zone_fares','portal_promos','portal_addons','portal_offers']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_touch_%1$I ON public.%1$I', t);
    EXECUTE format('CREATE TRIGGER trg_touch_%1$I BEFORE UPDATE ON public.%1$I FOR EACH ROW EXECUTE FUNCTION public.portal_touch_updated_at()', t);
  END LOOP;
END $$;