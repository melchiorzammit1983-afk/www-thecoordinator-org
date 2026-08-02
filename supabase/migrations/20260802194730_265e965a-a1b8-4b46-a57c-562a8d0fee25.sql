ALTER TABLE public.operations
  DROP CONSTRAINT operations_legacy_job_id_fkey,
  ADD CONSTRAINT operations_legacy_job_id_fkey
    FOREIGN KEY (legacy_job_id) REFERENCES public.jobs(id)
    ON DELETE SET NULL
    DEFERRABLE INITIALLY DEFERRED;