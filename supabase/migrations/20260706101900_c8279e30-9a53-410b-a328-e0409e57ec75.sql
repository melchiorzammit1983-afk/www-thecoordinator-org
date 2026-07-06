ALTER TABLE public.trip_messages
  ADD COLUMN IF NOT EXISTS driver_id uuid NULL REFERENCES public.drivers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS trip_messages_job_thread_driver_idx
  ON public.trip_messages (job_id, thread_kind, driver_id);

UPDATE public.trip_messages tm
   SET driver_id = j.driver_id
  FROM public.jobs j
 WHERE tm.job_id = j.id
   AND tm.driver_id IS NULL
   AND tm.thread_kind IN ('driver_client','driver_coord')
   AND j.driver_id IS NOT NULL;