begin;

create table if not exists public.user_session_activity (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  organization_id uuid,
  session_id text not null,
  login_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  logout_at timestamptz,
  browser text,
  device_type text,
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_session_activity
  add column if not exists user_id uuid,
  add column if not exists organization_id uuid,
  add column if not exists session_id text,
  add column if not exists login_at timestamptz default now(),
  add column if not exists last_seen_at timestamptz default now(),
  add column if not exists logout_at timestamptz,
  add column if not exists browser text,
  add column if not exists device_type text,
  add column if not exists ip_address text,
  add column if not exists user_agent text,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_session_activity_session_id_key'
      and conrelid = 'public.user_session_activity'::regclass
  ) then
    alter table public.user_session_activity
      add constraint user_session_activity_session_id_key unique (session_id);
  end if;
end $$;

create index if not exists user_session_activity_user_idx
  on public.user_session_activity (user_id, last_seen_at desc);

create index if not exists user_session_activity_session_idx
  on public.user_session_activity (session_id);

create index if not exists user_session_activity_last_seen_idx
  on public.user_session_activity (last_seen_at desc);

create index if not exists user_session_activity_logout_idx
  on public.user_session_activity (logout_at);

create index if not exists user_session_activity_organization_idx
  on public.user_session_activity (organization_id, last_seen_at desc);

alter table public.user_session_activity enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on table public.user_session_activity to service_role;
  end if;
end $$;

commit;
