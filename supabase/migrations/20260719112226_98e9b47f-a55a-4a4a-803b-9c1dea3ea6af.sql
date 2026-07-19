
create table if not exists public.public_ai_daily_counters (
  day date primary key,
  count integer not null default 0,
  updated_at timestamptz not null default now()
);

grant select, insert, update on public.public_ai_daily_counters to service_role;

alter table public.public_ai_daily_counters enable row level security;

create or replace function public.bump_public_ai_daily_count()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare new_count integer;
begin
  insert into public.public_ai_daily_counters (day, count)
  values (current_date, 1)
  on conflict (day) do update
    set count = public.public_ai_daily_counters.count + 1,
        updated_at = now()
  returning count into new_count;
  return new_count;
end
$$;

create or replace function public.get_public_ai_daily_count()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select count from public.public_ai_daily_counters where day = current_date), 0);
$$;

revoke all on function public.bump_public_ai_daily_count() from public, anon, authenticated;
revoke all on function public.get_public_ai_daily_count() from public, anon, authenticated;
grant execute on function public.bump_public_ai_daily_count() to service_role;
grant execute on function public.get_public_ai_daily_count() to service_role;
