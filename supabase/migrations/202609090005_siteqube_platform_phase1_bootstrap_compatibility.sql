-- Self-contained SiteQube Phase 1 bootstrap.
-- This migration is schema/security only: it never seeds tenant data.

create table if not exists public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  membership_status text not null default 'active'
    check (membership_status in ('invited', 'active', 'suspended', 'revoked')),
  membership_type text,
  is_primary boolean not null default false,
  joined_at timestamptz,
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_memberships_org_user_unique unique (organization_id, user_id)
);

create index if not exists organization_memberships_user_idx
  on public.organization_memberships (user_id, membership_status);

create index if not exists organization_memberships_org_idx
  on public.organization_memberships (organization_id, membership_status);

create table if not exists public.organization_modules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  module_code text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  constraint organization_modules_org_module_unique unique (organization_id, module_code)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.organization_memberships'::regclass
      and conname = 'organization_memberships_organization_id_fkey'
  ) then
    alter table public.organization_memberships
      add constraint organization_memberships_organization_id_fkey
      foreign key (organization_id) references public.organizations(id) on delete cascade;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.organization_memberships'::regclass
      and conname = 'organization_memberships_user_id_fkey'
  ) then
    alter table public.organization_memberships
      add constraint organization_memberships_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete cascade;
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
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

alter table public.organization_memberships enable row level security;
alter table public.organization_modules enable row level security;
alter table public.organization_domains enable row level security;

revoke all on table public.organization_memberships from anon, authenticated;
revoke all on table public.organization_modules from anon, authenticated;
revoke all on table public.organization_domains from anon, authenticated;

grant all on table public.organization_memberships to service_role;
grant all on table public.organization_modules to service_role;
grant all on table public.organization_domains to service_role;
