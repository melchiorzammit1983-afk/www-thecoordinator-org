-- Milestone 26 / Stage 5: approval-required Portal submissions.
-- A pending submission is not a Job. The authoritative Job/Trip is created
-- only after an authenticated coordinator approves it.

CREATE TABLE public.portal_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_id uuid NOT NULL REFERENCES public.portals(id) ON DELETE RESTRICT,
  portal_recipient_id uuid NOT NULL REFERENCES public.portal_recipients(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approving', 'approved', 'rejected')),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  job_id uuid REFERENCES public.jobs(id) ON DELETE RESTRICT,
  decided_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at timestamptz,
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (status = 'approved' AND job_id IS NOT NULL AND decided_at IS NOT NULL)
    OR (status = 'rejected' AND job_id IS NULL AND decided_at IS NOT NULL)
    OR (status IN ('pending', 'approving') AND job_id IS NULL AND decided_at IS NULL)
  )
);

CREATE INDEX portal_submissions_company_status_idx
  ON public.portal_submissions (company_id, status, created_at DESC);
CREATE INDEX portal_submissions_portal_status_idx
  ON public.portal_submissions (portal_id, status, created_at DESC);
CREATE INDEX portal_submissions_recipient_idx
  ON public.portal_submissions (portal_recipient_id, created_at DESC);
CREATE UNIQUE INDEX portal_submissions_job_idx
  ON public.portal_submissions (job_id) WHERE job_id IS NOT NULL;
CREATE UNIQUE INDEX jobs_portal_submission_source_idx
  ON public.jobs (source) WHERE source LIKE 'portal:%:submission:%';

DROP TRIGGER IF EXISTS trg_portal_submissions_touch_updated_at ON public.portal_submissions;
CREATE TRIGGER trg_portal_submissions_touch_updated_at
  BEFORE UPDATE ON public.portal_submissions
  FOR EACH ROW EXECUTE FUNCTION public.touch_transport_updated_at();

ALTER TABLE public.portal_submissions ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.portal_submissions TO authenticated;
GRANT ALL ON public.portal_submissions TO service_role;

CREATE POLICY "Company owners view portal submissions"
  ON public.portal_submissions FOR SELECT TO authenticated
  USING (private.is_company_owner(auth.uid(), company_id) OR private.is_admin(auth.uid()));
