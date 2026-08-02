-- Transport Core: operations.status is an enum, while CASE expressions return
-- text. Cast explicitly so the jobs -> operations trigger can create jobs.
CREATE OR REPLACE FUNCTION public.ensure_job_operation_id()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_name text;
BEGIN
  IF tg_op = 'UPDATE' AND new.operation_id IS NULL THEN
    new.operation_id := old.operation_id;
  END IF;

  v_name := public.derive_operation_name(
    nullif(new.group_name, ''),
    nullif(new.clientcompanyname, ''),
    new.from_location,
    new.to_location
  );

  IF new.operation_id IS NULL THEN
    INSERT INTO public.operations (
      company_id, legacy_job_id, name, company, status, source
    ) VALUES (
      new.company_id,
      new.id,
      v_name,
      nullif(new.clientcompanyname, ''),
      (CASE WHEN new.status IN ('completed', 'cancelled') THEN 'completed' ELSE 'active' END)::public.operation_status,
      'legacy_job'
    )
    RETURNING id INTO new.operation_id;
  ELSE
    PERFORM 1 FROM public.operations WHERE id = new.operation_id;

    IF NOT FOUND THEN
      INSERT INTO public.operations (
        id, company_id, name, company, status, source
      ) VALUES (
        new.operation_id,
        new.company_id,
        v_name,
        nullif(new.clientcompanyname, ''),
        (CASE WHEN new.status IN ('completed', 'cancelled') THEN 'completed' ELSE 'active' END)::public.operation_status,
        'legacy_job'
      );
    END IF;
  END IF;

  RETURN new;
END;
$$;
