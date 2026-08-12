begin;

create table if not exists public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  recipient_user_id uuid not null references public.profiles(id) on delete cascade,
  notification_type text not null,
  title text not null,
  message text not null,
  target_url text,
  related_entity_type text,
  related_entity_id uuid,
  is_read boolean not null default false,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  created_by_name text
);

create index if not exists user_notifications_recipient_unread_created_idx
  on public.user_notifications (recipient_user_id, is_read, created_at desc);

create index if not exists user_notifications_related_entity_idx
  on public.user_notifications (related_entity_type, related_entity_id);

alter table public.user_notifications enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on table public.user_notifications to service_role;
  end if;
end $$;

commit;
