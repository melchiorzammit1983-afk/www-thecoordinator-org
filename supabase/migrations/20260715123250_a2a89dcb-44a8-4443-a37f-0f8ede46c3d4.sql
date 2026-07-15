CREATE TABLE public.job_coord_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  requested_by uuid,
  kind text NOT NULL CHECK (kind IN ('edit','reassign','cancel','delete')),
  requested_changes jsonb NOT NULL DEFAULT '{}'::jsonb,
  note text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  decided_at timestamptz,
  decided_by_driver_id uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  decided_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.job_coord_change_requests TO authenticated;
GRANT ALL ON public.job_coord_change_requests TO service_role;

ALTER TABLE public.job_coord_change_requests ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_jccr_job_status ON public.job_coord_change_requests(job_id, status);
CREATE UNIQUE INDEX uq_jccr_one_pending_per_kind
  ON public.job_coord_change_requests(job_id, kind)
  WHERE status = 'pending';

-- Coordinators (company owners) can read requests for their company
CREATE POLICY "coord_read_own_company"
  ON public.job_coord_change_requests
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.companies c
      WHERE c.id = job_coord_change_requests.company_id
        AND c.owner_user_id = auth.uid()
    )
    OR private.is_admin(auth.uid())
  );

-- Coordinators can create requests for their own company jobs
CREATE POLICY "coord_insert_own_company"
  ON public.job_coord_change_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.companies c
      WHERE c.id = job_coord_change_requests.company_id
        AND c.owner_user_id = auth.uid()
    )
    OR private.is_admin(auth.uid())
  );

-- Coordinators can cancel their own pending requests; admins can update any
CREATE POLICY "coord_update_own_company"
  ON public.job_coord_change_requests
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.companies c
      WHERE c.id = job_coord_change_requests.company_id
        AND c.owner_user_id = auth.uid()
    )
    OR private.is_admin(auth.uid())
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.companies c
      WHERE c.id = job_coord_change_requests.company_id
        AND c.owner_user_id = auth.uid()
    )
    OR private.is_admin(auth.uid())
  );

CREATE TRIGGER jccr_set_updated_at
  BEFORE UPDATE ON public.job_coord_change_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
