-- Port Directory foundation: company-private ports and their berths.
-- Access remains server-side, matching the existing Ship Operations pattern.
CREATE TABLE public.ports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
  code text CHECK (code IS NULL OR char_length(btrim(code)) BETWEEN 1 AND 32),
  country text NOT NULL CHECK (char_length(btrim(country)) BETWEEN 1 AND 120),
  address text NOT NULL CHECK (char_length(btrim(address)) BETWEEN 1 AND 300),
  latitude numeric CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  longitude numeric CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.berths (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  port_id uuid NOT NULL REFERENCES public.ports(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
  address_override text CHECK (address_override IS NULL OR char_length(btrim(address_override)) BETWEEN 1 AND 300),
  latitude_override numeric CHECK (latitude_override IS NULL OR latitude_override BETWEEN -90 AND 90),
  longitude_override numeric CHECK (longitude_override IS NULL OR longitude_override BETWEEN -180 AND 180),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ports_company_active_idx ON public.ports (company_id, active);
CREATE INDEX berths_port_active_idx ON public.berths (port_id, active);

CREATE UNIQUE INDEX ports_company_active_name_unique
  ON public.ports (company_id, lower(btrim(name)))
  WHERE active;

CREATE UNIQUE INDEX berths_port_active_name_unique
  ON public.berths (port_id, lower(btrim(name)))
  WHERE active;

GRANT ALL ON public.ports, public.berths TO service_role;
ALTER TABLE public.ports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.berths ENABLE ROW LEVEL SECURITY;

-- No direct browser policies: authenticated server functions resolve the
-- caller's company and enforce company ownership for every operation.
