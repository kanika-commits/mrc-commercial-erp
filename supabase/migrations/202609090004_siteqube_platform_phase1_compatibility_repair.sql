-- Reconcile the partially-created Phase 1 platform metadata without replaying
-- 202609090002 or changing existing MRC business data.

create index if not exists organization_memberships_user_idx
  on public.organization_memberships (user_id, membership_status);

create index if not exists organization_memberships_org_idx
  on public.organization_memberships (organization_id, membership_status);

alter table public.organization_memberships enable row level security;
revoke all on table public.organization_memberships from anon, authenticated;
grant all on table public.organization_memberships to service_role;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.organization_modules'::regclass
      and conname = 'organization_modules_organization_id_fkey'
  ) then
    alter table public.organization_modules
      add constraint organization_modules_organization_id_fkey
      foreign key (organization_id) references public.organizations(id);
  end if;
end
$$;

create index if not exists organization_modules_org_enabled_idx
  on public.organization_modules (organization_id, enabled, module_code);

alter table public.organization_modules enable row level security;
revoke all on table public.organization_modules from anon, authenticated;
grant all on table public.organization_modules to service_role;

create table if not exists public.organization_domains (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  hostname text,
  slug text,
  is_primary boolean not null default false,
  status text not null default 'pending'
    check (status in ('pending', 'active', 'disabled')),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_domains_identifier_required
    check (hostname is not null or slug is not null)
);

create unique index if not exists organization_domains_hostname_unique
  on public.organization_domains (hostname)
  where hostname is not null;

create unique index if not exists organization_domains_slug_unique
  on public.organization_domains (slug)
  where slug is not null;

create index if not exists organization_domains_org_idx
  on public.organization_domains (organization_id, status);

alter table public.organization_domains enable row level security;
revoke all on table public.organization_domains from anon, authenticated;
grant all on table public.organization_domains to service_role;
