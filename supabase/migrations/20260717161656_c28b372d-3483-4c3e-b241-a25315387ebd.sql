
create extension if not exists vector;

-- ai_lessons
create table if not exists public.ai_lessons (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('parse_pattern','qa','suggestion_rule','signal_fix')),
  scope text not null default 'company' check (scope in ('company','global')),
  company_id uuid references public.companies(id) on delete cascade,
  title text not null,
  example_input_redacted text not null,
  rule_text text not null,
  embedding vector(1536),
  status text not null default 'pending' check (status in ('pending','approved','rejected','archived')),
  submitted_by uuid references auth.users(id) on delete set null,
  approved_by uuid references auth.users(id) on delete set null,
  reject_reason text,
  usage_count int not null default 0,
  positive_count int not null default 0,
  negative_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ai_lessons_company_idx on public.ai_lessons(company_id, kind, status);
create index if not exists ai_lessons_scope_idx on public.ai_lessons(scope, status, kind);
create index if not exists ai_lessons_embedding_idx on public.ai_lessons using hnsw (embedding vector_cosine_ops);

grant select, insert, update on public.ai_lessons to authenticated;
grant all on public.ai_lessons to service_role;
alter table public.ai_lessons enable row level security;

-- Helper: is user platform admin
create or replace function public.is_platform_admin(_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.admin_emails ae
    join auth.users u on lower(u.email) = lower(ae.email)
    where u.id = _user_id
  )
$$;
revoke all on function public.is_platform_admin(uuid) from public;
grant execute on function public.is_platform_admin(uuid) to authenticated, service_role;

-- Helper: user's company id
create or replace function public.my_company_id(_user_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.companies where owner_user_id = _user_id limit 1
$$;
revoke all on function public.my_company_id(uuid) from public;
grant execute on function public.my_company_id(uuid) to authenticated, service_role;

create policy "lessons_read_own_company" on public.ai_lessons for select to authenticated
  using (company_id is not null and company_id = public.my_company_id(auth.uid()));
create policy "lessons_read_global_approved" on public.ai_lessons for select to authenticated
  using (scope = 'global' and status = 'approved');
create policy "lessons_read_admin" on public.ai_lessons for select to authenticated
  using (public.is_platform_admin(auth.uid()));
create policy "lessons_insert_own_company" on public.ai_lessons for insert to authenticated
  with check (
    submitted_by = auth.uid()
    and company_id = public.my_company_id(auth.uid())
    and scope = 'company'
    and status in ('pending','approved')
  );
create policy "lessons_update_own_pending" on public.ai_lessons for update to authenticated
  using (company_id = public.my_company_id(auth.uid()) and scope = 'company')
  with check (company_id = public.my_company_id(auth.uid()) and scope = 'company');
create policy "lessons_admin_all" on public.ai_lessons for all to authenticated
  using (public.is_platform_admin(auth.uid()))
  with check (public.is_platform_admin(auth.uid()));

-- feedback
create table if not exists public.ai_lesson_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  company_id uuid references public.companies(id) on delete cascade,
  surface text not null check (surface in ('guide','extract','suggestion','other')),
  vote text not null check (vote in ('up','down')),
  question_redacted text,
  answer_redacted text,
  correction_redacted text,
  route text,
  created_at timestamptz not null default now()
);
create index if not exists ai_lesson_feedback_company_idx on public.ai_lesson_feedback(company_id, created_at desc);
grant select, insert on public.ai_lesson_feedback to authenticated;
grant all on public.ai_lesson_feedback to service_role;
alter table public.ai_lesson_feedback enable row level security;
create policy "feedback_insert_self" on public.ai_lesson_feedback for insert to authenticated
  with check (user_id = auth.uid());
create policy "feedback_read_own_company" on public.ai_lesson_feedback for select to authenticated
  using (company_id = public.my_company_id(auth.uid()) or public.is_platform_admin(auth.uid()));

-- share settings
create table if not exists public.ai_lesson_share_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  contribute_to_global boolean not null default false,
  consume_global boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
grant select, insert, update on public.ai_lesson_share_settings to authenticated;
grant all on public.ai_lesson_share_settings to service_role;
alter table public.ai_lesson_share_settings enable row level security;
create policy "share_read_own" on public.ai_lesson_share_settings for select to authenticated
  using (company_id = public.my_company_id(auth.uid()) or public.is_platform_admin(auth.uid()));
create policy "share_upsert_own" on public.ai_lesson_share_settings for insert to authenticated
  with check (company_id = public.my_company_id(auth.uid()));
create policy "share_update_own" on public.ai_lesson_share_settings for update to authenticated
  using (company_id = public.my_company_id(auth.uid()))
  with check (company_id = public.my_company_id(auth.uid()));

-- pii audit
create table if not exists public.ai_pii_audit (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  source text not null,
  stripped_types jsonb not null default '{}'::jsonb,
  input_length int,
  output_length int,
  created_at timestamptz not null default now()
);
create index if not exists ai_pii_audit_company_idx on public.ai_pii_audit(company_id, created_at desc);
grant select, insert on public.ai_pii_audit to authenticated;
grant all on public.ai_pii_audit to service_role;
alter table public.ai_pii_audit enable row level security;
create policy "pii_insert_self" on public.ai_pii_audit for insert to authenticated
  with check (user_id = auth.uid());
create policy "pii_read_own_or_admin" on public.ai_pii_audit for select to authenticated
  using (company_id = public.my_company_id(auth.uid()) or public.is_platform_admin(auth.uid()));

-- Similarity search RPC
create or replace function public.match_ai_lessons(
  query_embedding vector(1536),
  _company_id uuid,
  _kind text,
  _limit int default 5
)
returns table (
  id uuid,
  kind text,
  scope text,
  title text,
  rule_text text,
  example_input_redacted text,
  similarity float
)
language sql stable security definer set search_path = public as $$
  with candidates as (
    select l.*
    from public.ai_lessons l
    left join public.ai_lesson_share_settings s on s.company_id = _company_id
    where l.status = 'approved'
      and l.kind = _kind
      and l.embedding is not null
      and (
        (l.scope = 'company' and l.company_id = _company_id)
        or (l.scope = 'global' and coalesce(s.consume_global, true))
      )
  )
  select
    c.id, c.kind, c.scope, c.title, c.rule_text, c.example_input_redacted,
    1 - (c.embedding <=> query_embedding) as similarity
  from candidates c
  order by c.embedding <=> query_embedding
  limit greatest(1, least(_limit, 20))
$$;
revoke all on function public.match_ai_lessons(vector,uuid,text,int) from public;
grant execute on function public.match_ai_lessons(vector,uuid,text,int) to authenticated, service_role;

-- updated_at trigger
create or replace function public.tg_ai_lessons_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists ai_lessons_updated_at on public.ai_lessons;
create trigger ai_lessons_updated_at before update on public.ai_lessons
  for each row execute function public.tg_ai_lessons_updated_at();
