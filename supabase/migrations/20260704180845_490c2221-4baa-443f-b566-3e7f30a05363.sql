ALTER TABLE public.access_requests
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'access',
  ADD COLUMN IF NOT EXISTS notes_admin text;

ALTER TABLE public.access_requests
  DROP CONSTRAINT IF EXISTS access_requests_kind_check;
ALTER TABLE public.access_requests
  ADD CONSTRAINT access_requests_kind_check CHECK (kind IN ('access','demo'));

CREATE INDEX IF NOT EXISTS access_requests_kind_idx ON public.access_requests(kind);