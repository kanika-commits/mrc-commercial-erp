-- Reusable site-scoped delivery locations for Purchase Orders.
-- Apply manually after review; this migration does not create business records.
create table if not exists public.site_delivery_locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  site_id uuid not null references public.sites(id) on delete restrict,
  location_name text not null check (length(btrim(location_name)) > 0),
  address text not null check (length(btrim(address)) > 0),
  is_default boolean not null default false,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists site_delivery_locations_site_idx
  on public.site_delivery_locations(site_id, status);

create unique index if not exists site_delivery_locations_active_name_idx
  on public.site_delivery_locations(site_id, lower(btrim(location_name)))
  where status = 'active';

create unique index if not exists site_delivery_locations_one_default_idx
  on public.site_delivery_locations(site_id)
  where is_default and status = 'active';

create or replace function public.validate_site_delivery_location_scope()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1
    from public.sites s
    where s.id = new.site_id
      and s.organization_id = new.organization_id
  ) then
    raise exception 'Site does not belong to the supplied organization';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_site_delivery_location_scope
  on public.site_delivery_locations;

create trigger trg_validate_site_delivery_location_scope
before insert or update of organization_id, site_id
on public.site_delivery_locations
for each row
execute function public.validate_site_delivery_location_scope();

alter table public.site_delivery_locations enable row level security;
revoke all on table public.site_delivery_locations from public, anon, authenticated;
grant all on table public.site_delivery_locations to service_role;
