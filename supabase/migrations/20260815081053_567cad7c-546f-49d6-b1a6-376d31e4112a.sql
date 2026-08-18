CREATE TABLE IF NOT EXISTS public.portal_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_id uuid NOT NULL REFERENCES public.portals(id) ON DELETE CASCADE,
  portal_recipient_id uuid REFERENCES public.portal_recipients(id) ON DELETE SET NULL,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  rejection_reason text,
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT portal_submissions_status_check CHECK (status IN ('pending','approving','approved','rejected'))
);

CREATE INDEX IF NOT EXISTS portal_submissions_portal_idx ON public.portal_submissions(portal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS portal_submissions_company_idx ON public.portal_submissions(company_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS portal_submissions_job_idx ON public.portal_submissions(job_id) WHERE job_id IS NOT NULL;

GRANT SELECT ON public.portal_submissions TO authenticated;
GRANT ALL ON public.portal_submissions TO service_role;

ALTER TABLE public.portal_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Company members can view their portal submissions" ON public.portal_submissions;
CREATE POLICY "Company members can view their portal submissions"
ON public.portal_submissions FOR SELECT TO authenticated
USING (
  company_id IN (
    SELECT c.id FROM public.companies c WHERE c.owner_user_id = auth.uid()
    UNION
    SELECT d.company_id FROM public.drivers d WHERE d.linked_user_id = auth.uid()
  )
);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS update_portal_submissions_updated_at ON public.portal_submissions;
CREATE TRIGGER update_portal_submissions_updated_at
BEFORE UPDATE ON public.portal_submissions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();