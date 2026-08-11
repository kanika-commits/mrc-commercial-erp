create table if not exists public.site_hr_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete restrict,
  site_id uuid not null references public.sites(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete restrict,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_by uuid, created_by_name text, created_by_email text,
  created_at timestamptz not null default now(),
  updated_by uuid, updated_by_name text, updated_by_email text,
  updated_at timestamptz not null default now()
);
drop index if exists public.site_hr_assignments_active_uidx;
create unique index if not exists site_hr_assignments_uidx on public.site_hr_assignments (organization_id, company_id, site_id, user_id);
create index if not exists site_hr_assignments_scope_idx on public.site_hr_assignments (organization_id, company_id, site_id, status);
insert into public.site_hr_assignments (organization_id, company_id, site_id, user_id, status, created_at, updated_at)
select organization_id, company_id, site_id, site_hr_user_id, 'active', created_at, updated_at
from public.labour_site_configurations where site_hr_user_id is not null on conflict do nothing;
alter table public.site_hr_assignments enable row level security;
grant all on public.site_hr_assignments to service_role;
