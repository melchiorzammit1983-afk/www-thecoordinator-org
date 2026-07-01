CREATE TABLE public.trip_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  sender_kind text NOT NULL CHECK (sender_kind IN ('driver','coordinator')),
  sender_label text,
  body text NOT NULL CHECK (length(body) > 0 AND length(body) <= 4000),
  read_by_driver_at timestamptz,
  read_by_coordinator_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX trip_messages_job_idx ON public.trip_messages(job_id, created_at);

GRANT SELECT, INSERT, UPDATE ON public.trip_messages TO authenticated;
GRANT ALL ON public.trip_messages TO service_role;

ALTER TABLE public.trip_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company owners read trip messages" ON public.trip_messages
  FOR SELECT TO authenticated
  USING (public.is_company_owner(auth.uid(), company_id) OR public.is_admin(auth.uid()));

CREATE POLICY "Company owners insert trip messages" ON public.trip_messages
  FOR INSERT TO authenticated
  WITH CHECK ((public.is_company_owner(auth.uid(), company_id) OR public.is_admin(auth.uid())) AND sender_kind = 'coordinator');

CREATE POLICY "Company owners update trip messages" ON public.trip_messages
  FOR UPDATE TO authenticated
  USING (public.is_company_owner(auth.uid(), company_id) OR public.is_admin(auth.uid()))
  WITH CHECK (public.is_company_owner(auth.uid(), company_id) OR public.is_admin(auth.uid()));

CREATE TRIGGER trg_trip_messages_updated_at
  BEFORE UPDATE ON public.trip_messages
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();