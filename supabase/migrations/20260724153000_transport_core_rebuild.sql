-- Transport core rebuild: operations -> trips -> passengers.
-- The legacy jobs/pax tables remain in place for compatibility while the new
-- model is populated and kept in sync.

do $$
begin
  create type public.operation_status as enum ('planning', 'active', 'completed');
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.trip_status_v2 as enum ('planned', 'assigned', 'in_progress', 'completed', 'cancelled');
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.passenger_type_v2 as enum ('joining', 'leaving', 'transfer', 'hotel', 'other');
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.passenger_row_status_v2 as enum ('valid', 'warning', 'incomplete');
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.trip_stop_type_v2 as enum ('pickup', 'stop', 'dropoff');
exception
  when duplicate_object then null;
end
$$;

alter table public.jobs
  add column if not exists operation_id uuid;

alter table public.pax
  add column if not exists operation_id uuid;

create table if not exists public.operations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  legacy_job_id uuid unique references public.jobs(id) on delete set null,
  name text not null,
  company text,
  tags text[] not null default '{}'::text[],
  status public.operation_status not null default 'planning',
  source text not null default 'manual',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.trips (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null references public.operations(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete cascade,
  legacy_job_id uuid unique references public.jobs(id) on delete cascade,
  trip_no integer,
  from_location text not null,
  to_location text not null,
  pickup_display_name text,
  dropoff_display_name text,
  pickup_place_id text,
  dropoff_place_id text,
  date text not null,
  time text not null,
  pickup_at timestamptz,
  status public.trip_status_v2 not null default 'planned',
  driver_id uuid references public.drivers(id) on delete set null,
  vehicle text,
  contact_phone text,
  clientcompanyname text,
  tracking_enabled boolean not null default false,
  qr_strict_mode boolean not null default false,
  tracking_kind text,
  client_link_token text,
  route_duration_sec integer,
  route_distance_m integer,
  route_computed_at timestamptz,
  live_eta_sec integer,
  live_eta_updated_at timestamptz,
  from_flight text,
  to_flight text,
  flightorship text,
  flight_status text,
  flight_status_note text,
  flight_status_confidence text,
  flight_scheduled_at timestamptz,
  flight_estimated_at timestamptz,
  flight_status_updated_at timestamptz,
  traffic_delay_minutes integer,
  traffic_severity text,
  leave_by_at timestamptz,
  pickup_shift_reason text,
  grouped_count integer,
  grouped_at timestamptz,
  group_name text,
  group_note text,
  created_by_driver boolean not null default false,
  needs_review boolean not null default false,
  parent_trip_id uuid references public.trips(id) on delete set null,
  source text not null default 'manual',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.passengers (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null references public.operations(id) on delete cascade,
  trip_id uuid not null references public.trips(id) on delete cascade,
  legacy_pax_id uuid unique references public.pax(id) on delete cascade,
  row_number integer,
  type public.passenger_type_v2 not null default 'other',
  name text not null,
  phone text,
  nationality text,
  from_location text,
  to_location text,
  date text,
  time text,
  flight_number text,
  vessel text,
  immigration_required boolean not null default false,
  annex1_required boolean not null default false,
  notes text,
  status public.passenger_row_status_v2 not null default 'valid',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.trip_stops (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  stop_order integer not null,
  type public.trip_stop_type_v2 not null,
  location text not null,
  time text,
  legacy_group_stop_id uuid unique references public.group_stops(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (trip_id, stop_order)
);

create index if not exists operations_company_id_idx on public.operations (company_id);
create index if not exists operations_legacy_job_id_idx on public.operations (legacy_job_id);
create index if not exists trips_operation_id_idx on public.trips (operation_id);
create index if not exists trips_company_id_idx on public.trips (company_id);
create index if not exists trips_legacy_job_id_idx on public.trips (legacy_job_id);
create index if not exists passengers_operation_id_idx on public.passengers (operation_id);
create index if not exists passengers_trip_id_idx on public.passengers (trip_id);
create index if not exists passengers_legacy_pax_id_idx on public.passengers (legacy_pax_id);
create index if not exists trip_stops_trip_id_idx on public.trip_stops (trip_id);

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'jobs_operation_id_fkey'
  ) then
    alter table public.jobs
      add constraint jobs_operation_id_fkey
      foreign key (operation_id) references public.operations(id) on delete restrict;
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'pax_operation_id_fkey'
  ) then
    alter table public.pax
      add constraint pax_operation_id_fkey
      foreign key (operation_id) references public.operations(id) on delete cascade;
  end if;
end
$$;

alter table public.operations enable row level security;
alter table public.trips enable row level security;
alter table public.passengers enable row level security;
alter table public.trip_stops enable row level security;

create or replace function public.touch_transport_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_operations_touch_updated_at on public.operations;
create trigger trg_operations_touch_updated_at
  before update on public.operations
  for each row execute function public.touch_transport_updated_at();

drop trigger if exists trg_trips_touch_updated_at on public.trips;
create trigger trg_trips_touch_updated_at
  before update on public.trips
  for each row execute function public.touch_transport_updated_at();

drop trigger if exists trg_passengers_touch_updated_at on public.passengers;
create trigger trg_passengers_touch_updated_at
  before update on public.passengers
  for each row execute function public.touch_transport_updated_at();

drop trigger if exists trg_trip_stops_touch_updated_at on public.trip_stops;
create trigger trg_trip_stops_touch_updated_at
  before update on public.trip_stops
  for each row execute function public.touch_transport_updated_at();

create or replace function public.derive_operation_name(
  p_explicit text,
  p_client text,
  p_from text,
  p_to text
)
returns text
language plpgsql
stable
as $$
declare
  v_name text;
begin
  v_name := btrim(coalesce(p_explicit, ''));
  if v_name <> '' then
    return left(v_name, 120);
  end if;

  v_name := btrim(coalesce(p_client, ''));
  if v_name <> '' then
    return left(v_name, 120);
  end if;

  if btrim(coalesce(p_from, '')) <> '' and btrim(coalesce(p_to, '')) <> '' then
    return left(p_from || ' to ' || p_to, 120);
  end if;

  if btrim(coalesce(p_from, '')) <> '' then
    return left(p_from || ' departures', 120);
  end if;

  if btrim(coalesce(p_to, '')) <> '' then
    return left(p_to || ' arrivals', 120);
  end if;

  return 'Transport operation';
end;
$$;

create or replace function public.ensure_job_operation_id()
returns trigger
language plpgsql
as $$
declare
  v_name text;
begin
  if tg_op = 'UPDATE' and new.operation_id is null then
    new.operation_id := old.operation_id;
  end if;

  v_name := public.derive_operation_name(nullif(new.group_name, ''), nullif(new.clientcompanyname, ''), new.from_location, new.to_location);

  if new.operation_id is null then
    insert into public.operations (
      company_id,
      legacy_job_id,
      name,
      company,
      status,
      source
    ) values (
      new.company_id,
      new.id,
      v_name,
      nullif(new.clientcompanyname, ''),
      case when new.status in ('completed', 'cancelled') then 'completed' else 'active' end,
      'legacy_job'
    )
    returning id into new.operation_id;
  else
    perform 1
      from public.operations
     where id = new.operation_id;

    if not found then
      insert into public.operations (
        id,
        company_id,
        name,
        company,
        status,
        source
      ) values (
        new.operation_id,
        new.company_id,
        v_name,
        nullif(new.clientcompanyname, ''),
        case when new.status in ('completed', 'cancelled') then 'completed' else 'active' end,
        'legacy_job'
      );
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.refresh_trip_stops_for_job(
  p_job_id uuid,
  p_trip_id uuid,
  p_pickup_location text,
  p_dropoff_location text,
  p_pickup_display_name text,
  p_dropoff_display_name text,
  p_pickup_time text
)
returns void
language plpgsql
as $$
begin
  delete from public.trip_stops
   where trip_id = p_trip_id;

  insert into public.trip_stops (
    trip_id,
    stop_order,
    type,
    location,
    time
  ) values (
    p_trip_id,
    0,
    'pickup',
    coalesce(nullif(p_pickup_display_name, ''), p_pickup_location),
    nullif(left(coalesce(p_pickup_time, ''), 5), '')
  );

  with stop_rows as (
    select
      row_number() over (order by g.id, coalesce(gs.stop_index, 0), gs.id) as stop_order,
      coalesce(nullif(gs.display_name, ''), nullif(gs.address, ''), 'Stop ' || row_number() over (order by g.id, coalesce(gs.stop_index, 0), gs.id)) as location,
      gs.id as legacy_group_stop_id
    from public.groups g
    join public.group_stops gs on gs.group_id = g.id
    where g.job_id = p_job_id
  )
  insert into public.trip_stops (
    trip_id,
    stop_order,
    type,
    location,
    time,
    legacy_group_stop_id
  )
  select
    p_trip_id,
    s.stop_order,
    'stop',
    s.location,
    null,
    s.legacy_group_stop_id
  from stop_rows s;

  insert into public.trip_stops (
    trip_id,
    stop_order,
    type,
    location,
    time
  ) values (
    p_trip_id,
    coalesce((select max(stop_order) from public.trip_stops where trip_id = p_trip_id), 0) + 1,
    'dropoff',
    coalesce(nullif(p_dropoff_display_name, ''), p_dropoff_location),
    nullif(left(coalesce(p_pickup_time, ''), 5), '')
  );
end;
$$;

create or replace function public.mirror_job_to_transport_core()
returns trigger
language plpgsql
as $$
declare
  v_trip_status public.trip_status_v2;
begin
  if tg_op = 'DELETE' then
    delete from public.operations o
     where o.legacy_job_id = old.id
       and not exists (
         select 1
           from public.jobs j
          where j.operation_id = o.id
       )
       and not exists (
         select 1
           from public.trips t
          where t.operation_id = o.id
       );
    return old;
  end if;

  v_trip_status :=
    case lower(coalesce(new.status::text, ''))
      when 'pending' then 'planned'::public.trip_status_v2
      when 'active' then 'assigned'::public.trip_status_v2
      when 'en_route' then 'in_progress'::public.trip_status_v2
      when 'arrived' then 'in_progress'::public.trip_status_v2
      when 'in_progress' then 'in_progress'::public.trip_status_v2
      when 'completed' then 'completed'::public.trip_status_v2
      when 'cancelled' then 'cancelled'::public.trip_status_v2
      else 'planned'::public.trip_status_v2
    end;

  insert into public.trips (
    id,
    operation_id,
    company_id,
    legacy_job_id,
    trip_no,
    from_location,
    to_location,
    pickup_display_name,
    dropoff_display_name,
    pickup_place_id,
    dropoff_place_id,
    date,
    time,
    pickup_at,
    status,
    driver_id,
    vehicle,
    contact_phone,
    clientcompanyname,
    tracking_enabled,
    qr_strict_mode,
    tracking_kind,
    client_link_token,
    route_duration_sec,
    route_distance_m,
    route_computed_at,
    live_eta_sec,
    live_eta_updated_at,
    from_flight,
    to_flight,
    flightorship,
    flight_status,
    flight_status_note,
    flight_status_confidence,
    flight_scheduled_at,
    flight_estimated_at,
    flight_status_updated_at,
    traffic_delay_minutes,
    traffic_severity,
    leave_by_at,
    pickup_shift_reason,
    grouped_count,
    grouped_at,
    group_name,
    group_note,
    created_by_driver,
    needs_review,
    parent_trip_id,
    source,
    updated_at
  ) values (
    new.id,
    new.operation_id,
    new.company_id,
    new.id,
    new.trip_no,
    new.from_location,
    new.to_location,
    new.pickup_display_name,
    new.dropoff_display_name,
    new.pickup_place_id,
    new.dropoff_place_id,
    new.date,
    new.time,
    new.pickup_at,
    v_trip_status,
    new.driver_id,
    new.vehicle,
    new.contact_phone,
    new.clientcompanyname,
    new.tracking_enabled,
    new.qr_strict_mode,
    new.tracking_kind,
    new.client_link_token,
    new.route_duration_sec,
    new.route_distance_m,
    new.route_computed_at,
    new.live_eta_sec,
    new.live_eta_updated_at,
    new.from_flight,
    new.to_flight,
    new.flightorship,
    new.flight_status,
    new.flight_status_note,
    new.flight_status_confidence,
    new.flight_scheduled_at,
    new.flight_estimated_at,
    new.flight_status_updated_at,
    new.traffic_delay_minutes,
    new.traffic_severity,
    new.leave_by_at,
    new.pickup_shift_reason,
    new.grouped_count,
    new.grouped_at,
    new.group_name,
    new.group_note,
    coalesce(new.created_by_driver, false),
    coalesce(new.needs_review, false),
    new.parent_job_id,
    'legacy_job',
    now()
  )
  on conflict (id) do update set
    operation_id = excluded.operation_id,
    company_id = excluded.company_id,
    from_location = excluded.from_location,
    to_location = excluded.to_location,
    pickup_display_name = excluded.pickup_display_name,
    dropoff_display_name = excluded.dropoff_display_name,
    pickup_place_id = excluded.pickup_place_id,
    dropoff_place_id = excluded.dropoff_place_id,
    date = excluded.date,
    time = excluded.time,
    pickup_at = excluded.pickup_at,
    status = excluded.status,
    driver_id = excluded.driver_id,
    vehicle = excluded.vehicle,
    contact_phone = excluded.contact_phone,
    clientcompanyname = excluded.clientcompanyname,
    tracking_enabled = excluded.tracking_enabled,
    qr_strict_mode = excluded.qr_strict_mode,
    tracking_kind = excluded.tracking_kind,
    client_link_token = excluded.client_link_token,
    route_duration_sec = excluded.route_duration_sec,
    route_distance_m = excluded.route_distance_m,
    route_computed_at = excluded.route_computed_at,
    live_eta_sec = excluded.live_eta_sec,
    live_eta_updated_at = excluded.live_eta_updated_at,
    from_flight = excluded.from_flight,
    to_flight = excluded.to_flight,
    flightorship = excluded.flightorship,
    flight_status = excluded.flight_status,
    flight_status_note = excluded.flight_status_note,
    flight_status_confidence = excluded.flight_status_confidence,
    flight_scheduled_at = excluded.flight_scheduled_at,
    flight_estimated_at = excluded.flight_estimated_at,
    flight_status_updated_at = excluded.flight_status_updated_at,
    traffic_delay_minutes = excluded.traffic_delay_minutes,
    traffic_severity = excluded.traffic_severity,
    leave_by_at = excluded.leave_by_at,
    pickup_shift_reason = excluded.pickup_shift_reason,
    grouped_count = excluded.grouped_count,
    grouped_at = excluded.grouped_at,
    group_name = excluded.group_name,
    group_note = excluded.group_note,
    created_by_driver = excluded.created_by_driver,
    needs_review = excluded.needs_review,
    parent_trip_id = excluded.parent_trip_id,
    source = excluded.source,
    updated_at = now();

  update public.passengers p
     set operation_id = new.operation_id,
         from_location = new.from_location,
         to_location = new.to_location,
         date = new.date,
         time = new.time,
         flight_number = nullif(coalesce(new.from_flight, new.to_flight, new.flightorship), ''),
         vessel = case when new.tracking_kind = 'vessel' then nullif(coalesce(new.from_flight, new.to_flight, new.flightorship), '') else p.vessel end,
         updated_at = now()
   where p.trip_id = new.id;

  perform public.refresh_trip_stops_for_job(
    new.id,
    new.id,
    new.from_location,
    new.to_location,
    new.pickup_display_name,
    new.dropoff_display_name,
    new.time
  );

  return new;
end;
$$;

create or replace function public.mirror_pax_to_transport_core()
returns trigger
language plpgsql
as $$
declare
  v_operation_id uuid;
  v_job record;
begin
  if tg_op = 'DELETE' then
    delete from public.passengers
     where legacy_pax_id = old.id;
    return old;
  end if;

  select
    j.operation_id,
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
  if v_operation_id is null then
    return new;
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

drop trigger if exists trg_jobs_transport_core_operation on public.jobs;
create trigger trg_jobs_transport_core_operation
  before insert or update on public.jobs
  for each row execute function public.ensure_job_operation_id();

drop trigger if exists trg_jobs_transport_core_mirror on public.jobs;
create trigger trg_jobs_transport_core_mirror
  after insert or update or delete on public.jobs
  for each row execute function public.mirror_job_to_transport_core();

drop trigger if exists trg_pax_transport_core_mirror on public.pax;
create trigger trg_pax_transport_core_mirror
  after insert or update or delete on public.pax
  for each row execute function public.mirror_pax_to_transport_core();

-- Backfill the new transport core from legacy jobs/pax.
insert into public.operations (
  company_id,
  legacy_job_id,
  name,
  company,
  status,
  source,
  created_at,
  updated_at
)
select
  j.company_id,
  j.id,
  public.derive_operation_name(nullif(j.group_name, ''), nullif(j.clientcompanyname, ''), j.from_location, j.to_location),
  nullif(j.clientcompanyname, ''),
  case when j.status in ('completed', 'cancelled') then 'completed' else 'active' end,
  'legacy_job',
  j.created_at,
  j.updated_at
from public.jobs j
where not exists (
  select 1
    from public.operations o
   where o.legacy_job_id = j.id
);

update public.jobs j
   set operation_id = o.id
  from public.operations o
 where o.legacy_job_id = j.id
   and (j.operation_id is distinct from o.id or j.operation_id is null);

insert into public.trips (
  id,
  operation_id,
  company_id,
  legacy_job_id,
  trip_no,
  from_location,
  to_location,
  pickup_display_name,
  dropoff_display_name,
  pickup_place_id,
  dropoff_place_id,
  date,
  time,
  pickup_at,
  status,
  driver_id,
  vehicle,
  contact_phone,
  clientcompanyname,
  tracking_enabled,
  qr_strict_mode,
  tracking_kind,
  client_link_token,
  route_duration_sec,
  route_distance_m,
  route_computed_at,
  live_eta_sec,
  live_eta_updated_at,
  from_flight,
  to_flight,
  flightorship,
  flight_status,
  flight_status_note,
  flight_status_confidence,
  flight_scheduled_at,
  flight_estimated_at,
  flight_status_updated_at,
  traffic_delay_minutes,
  traffic_severity,
  leave_by_at,
  pickup_shift_reason,
  grouped_count,
  grouped_at,
  group_name,
  group_note,
  created_by_driver,
  needs_review,
  parent_trip_id,
  source,
  metadata,
  created_at,
  updated_at
)
select
  j.id,
  j.operation_id,
  j.company_id,
  j.id,
  j.trip_no,
  j.from_location,
  j.to_location,
  j.pickup_display_name,
  j.dropoff_display_name,
  j.pickup_place_id,
  j.dropoff_place_id,
  j.date,
  j.time,
  j.pickup_at,
  case lower(coalesce(j.status::text, ''))
    when 'pending' then 'planned'::public.trip_status_v2
    when 'active' then 'assigned'::public.trip_status_v2
    when 'en_route' then 'in_progress'::public.trip_status_v2
    when 'arrived' then 'in_progress'::public.trip_status_v2
    when 'in_progress' then 'in_progress'::public.trip_status_v2
    when 'completed' then 'completed'::public.trip_status_v2
    when 'cancelled' then 'cancelled'::public.trip_status_v2
    else 'planned'::public.trip_status_v2
  end,
  j.driver_id,
  j.vehicle,
  j.contact_phone,
  j.clientcompanyname,
  j.tracking_enabled,
  j.qr_strict_mode,
  j.tracking_kind,
  j.client_link_token,
  j.route_duration_sec,
  j.route_distance_m,
  j.route_computed_at,
  j.live_eta_sec,
  j.live_eta_updated_at,
  j.from_flight,
  j.to_flight,
  j.flightorship,
  j.flight_status,
  j.flight_status_note,
  j.flight_status_confidence,
  j.flight_scheduled_at,
  j.flight_estimated_at,
  j.flight_status_updated_at,
  j.traffic_delay_minutes,
  j.traffic_severity,
  j.leave_by_at,
  j.pickup_shift_reason,
  j.grouped_count,
  j.grouped_at,
  j.group_name,
  j.group_note,
  coalesce(j.created_by_driver, false),
  coalesce(j.needs_review, false),
  j.parent_job_id,
  'legacy_job',
  '{}'::jsonb,
  j.created_at,
  j.updated_at
from public.jobs j
where not exists (
  select 1
    from public.trips t
   where t.legacy_job_id = j.id
);

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
  created_at,
  updated_at
)
select
  p.id,
  j.operation_id,
  p.job_id,
  p.id,
  'other',
  p.name,
  p.phone,
  p.note,
  j.from_location,
  j.to_location,
  j.date,
  j.time,
  nullif(coalesce(j.from_flight, j.to_flight, j.flightorship), ''),
  case when j.tracking_kind = 'vessel' then nullif(coalesce(j.from_flight, j.to_flight, j.flightorship), '') else null end,
  false,
  false,
  case lower(coalesce(p.status::text, ''))
    when 'delayed' then 'warning'::public.passenger_row_status_v2
    when 'noshow' then 'incomplete'::public.passenger_row_status_v2
    when 'cancelled' then 'incomplete'::public.passenger_row_status_v2
    else 'valid'::public.passenger_row_status_v2
  end,
  p.created_at,
  p.updated_at
from public.pax p
join public.jobs j on j.id = p.job_id
where not exists (
  select 1
    from public.passengers x
   where x.legacy_pax_id = p.id
);

insert into public.trip_stops (
  trip_id,
  stop_order,
  type,
  location,
  time,
  legacy_group_stop_id
)
select
  t.id,
  0,
  'pickup',
  coalesce(nullif(t.pickup_display_name, ''), t.from_location),
  nullif(left(coalesce(t.time, ''), 5), ''),
  null
from public.trips t
where not exists (
  select 1
    from public.trip_stops s
   where s.trip_id = t.id
     and s.stop_order = 0
);

with stop_rows as (
  select
    t.id as trip_id,
    row_number() over (partition by t.id order by g.id, coalesce(gs.stop_index, 0), gs.id) as stop_order,
    coalesce(nullif(gs.display_name, ''), nullif(gs.address, ''), 'Stop ' || row_number() over (partition by t.id order by g.id, coalesce(gs.stop_index, 0), gs.id)) as location,
    gs.id as legacy_group_stop_id
  from public.trips t
  join public.groups g on g.job_id = t.legacy_job_id
  join public.group_stops gs on gs.group_id = g.id
)
insert into public.trip_stops (
  trip_id,
  stop_order,
  type,
  location,
  time,
  legacy_group_stop_id
)
select
  s.trip_id,
  s.stop_order,
  'stop',
  s.location,
  null,
  s.legacy_group_stop_id
from stop_rows s
where not exists (
  select 1
    from public.trip_stops x
   where x.legacy_group_stop_id = s.legacy_group_stop_id
);

insert into public.trip_stops (
  trip_id,
  stop_order,
  type,
  location,
  time,
  legacy_group_stop_id
)
select
  t.id,
  coalesce((select max(s.stop_order) from public.trip_stops s where s.trip_id = t.id), 0) + 1,
  'dropoff',
  coalesce(nullif(t.dropoff_display_name, ''), t.to_location),
  nullif(left(coalesce(t.time, ''), 5), ''),
  null
from public.trips t
where not exists (
  select 1
    from public.trip_stops s
   where s.trip_id = t.id
     and s.type = 'dropoff'
);

alter table public.jobs
  alter column operation_id set not null;

alter table public.pax
  alter column operation_id set not null;
