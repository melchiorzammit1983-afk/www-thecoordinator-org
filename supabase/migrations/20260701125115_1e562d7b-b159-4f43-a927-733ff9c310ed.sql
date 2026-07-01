
CREATE TABLE public.trip_labels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text NOT NULL DEFAULT '#3B82F6',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX trip_labels_company_name_uniq ON public.trip_labels (company_id, lower(name));
CREATE INDEX trip_labels_company_idx ON public.trip_labels (company_id, sort_order);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.trip_labels TO authenticated;
GRANT ALL ON public.trip_labels TO service_role;

ALTER TABLE public.trip_labels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "labels_company_read" ON public.trip_labels FOR SELECT TO authenticated
  USING (public.is_company_owner(auth.uid(), company_id) OR public.is_admin(auth.uid()));
CREATE POLICY "labels_company_write" ON public.trip_labels FOR ALL TO authenticated
  USING (public.is_company_owner(auth.uid(), company_id) OR public.is_admin(auth.uid()))
  WITH CHECK (public.is_company_owner(auth.uid(), company_id) OR public.is_admin(auth.uid()));

CREATE TRIGGER trip_labels_set_updated_at BEFORE UPDATE ON public.trip_labels
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


CREATE TABLE public.job_labels (
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  label_id uuid NOT NULL REFERENCES public.trip_labels(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, label_id)
);
CREATE INDEX job_labels_label_idx ON public.job_labels (label_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_labels TO authenticated;
GRANT ALL ON public.job_labels TO service_role;
GRANT SELECT ON public.job_labels TO anon;

ALTER TABLE public.job_labels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "job_labels_company_read" ON public.job_labels FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = job_id
    AND (public.is_company_owner(auth.uid(), j.company_id) OR public.is_admin(auth.uid()))));
CREATE POLICY "job_labels_company_write" ON public.job_labels FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = job_id
    AND (public.is_company_owner(auth.uid(), j.company_id) OR public.is_admin(auth.uid()))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = job_id
    AND (public.is_company_owner(auth.uid(), j.company_id) OR public.is_admin(auth.uid()))));
