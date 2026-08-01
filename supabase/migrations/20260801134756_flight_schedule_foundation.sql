-- Shared reference data only: no company, passenger, trip, or operational data.
CREATE TABLE public.flight_schedule_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  effective_from date,
  coverage_start date,
  coverage_end date,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (coverage_end IS NULL OR coverage_start IS NULL OR coverage_end >= coverage_start)
);

CREATE UNIQUE INDEX flight_schedule_versions_one_active_idx
  ON public.flight_schedule_versions ((status)) WHERE status = 'active';

CREATE TABLE public.flight_schedule_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_version_id uuid REFERENCES public.flight_schedule_versions(id) ON DELETE SET NULL,
  source_filename text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'validated', 'imported', 'failed')),
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX flight_schedule_imports_created_at_idx ON public.flight_schedule_imports (created_at DESC);

ALTER TABLE public.flight_schedule_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flight_schedule_imports ENABLE ROW LEVEL SECURITY;

-- No client policies by design. All access is through authenticated,
-- server-side admin functions that enforce the existing admin_emails guard.
