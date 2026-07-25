-- Fix: passengers were silently dropped from the new transport-core
-- "passengers" table whenever the parent job's operation_id was missing
-- (e.g. legacy jobs created before the operation-linking trigger existed,
-- or any write path that didn't go through ensure_job_operation_id()).
-- Instead of silently skipping the passenger row, self-heal the missing
-- operation link the same way ensure_job_operation_id() does for jobs,
-- then continue storing the passenger.

create or replace function public.mirror_pax_to_transport_core()
returns trigger
language plpgsql
security definer
as $$
declare
  v_operation_id uuid;
  v_job record;
  v_name text;
begin
  if tg_op = 'DELETE' then
    delete from public.passengers
    where legacy_pax_id = old.id;
    return old;
  end if;

  select
    j.operation_id,
    j.company_id,
    j.clientcompanyname,
    j.group_name,
    j.status,
    j.from_location,
    j.to_location,
    j.date,
    j.time,
    j.from_flight,
    j.to_flight,
    j.flightorship,
    j.tracking_kind
  into v_job
  from public.jobs j
  where j.id = new.job_id;

  if not found then
    return new;
  end if;

  v_operation_id := v_job.operation_id;

  -- Self-heal: a passenger should never be silently dropped just because
  -- the parent job hasn't been linked to an operation yet.
  if v_operation_id is null then
    select o.id into v_operation_id
    from public.operations o
    where o.legacy_job_id = new.job_id;

    if v_operation_id is null then
      v_name := public.derive_operation_name(
              nullif(v_job.group_name, ''),
              nullif(v_job.clientcompanyname, ''),
              v_job.from_location,
              v_job.to_location
            );

      insert into public.operations (
                company_id,
                legacy_job_id,
                name,
                company,
                status,
                source
              ) values (
                v_job.company_id,
                new.job_id,
                v_name,
                nullif(v_job.clientcompanyname, ''),
                case when v_job.status in ('completed', 'cancelled') then 'completed' else 'active' end,
                'legacy_job'
              )
      returning id into v_operation_id;
    end if;

    update public.jobs
    set operation_id = v_operation_id
    where id = new.job_id
      and operation_id is distinct from v_operation_id;
  end if;

  insert into public.passengers (
        id,
        operation_id,
        trip_id,
        legacy_pax_id,
        type,
        name,
        phone,
        notes,
        from_location,
        to_location,
        date,
        time,
        flight_number,
        vessel,
        immigration_required,
        annex1_required,
        status,
        updated_at
      ) values (
        new.id,
        v_operation_id,
        new.job_id,
        new.id,
        'other',
        new.name,
        nullif(new.phone, ''),
        nullif(new.note, ''),
        v_job.from_location,
        v_job.to_location,
        v_job.date,
        v_job.time,
        nullif(coalesce(v_job.from_flight, v_job.to_flight, v_job.flightorship), ''),
        case when v_job.tracking_kind = 'vessel' then nullif(coalesce(v_job.from_flight, v_job.to_flight, v_job.flightorship), '') else null end,
        false,
        false,
        case lower(coalesce(new.status::text, ''))
          when 'delayed' then 'warning'::public.passenger_row_status_v2
          when 'noshow' then 'incomplete'::public.passenger_row_status_v2
          when 'cancelled' then 'incomplete'::public.passenger_row_status_v2
          else 'valid'::public.passenger_row_status_v2
        end,
        now()
      )
  on conflict (legacy_pax_id) do update set
    operation_id = excluded.operation_id,
    trip_id = excluded.trip_id,
    type = excluded.type,
    name = excluded.name,
    phone = excluded.phone,
    notes = excluded.notes,
    from_location = excluded.from_location,
    to_location = excluded.to_location,
    date = excluded.date,
    time = excluded.time,
    flight_number = excluded.flight_number,
    vessel = excluded.vessel,
    immigration_required = excluded.immigration_required,
    annex1_required = excluded.annex1_required,
    status = excluded.status,
    updated_at = now();

  return new;
end;
$$;
$$;
