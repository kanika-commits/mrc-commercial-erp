-- Link site delivery locations to an existing company billing/GST registration.
-- Existing delivery rows remain valid and unassigned until explicitly linked.
alter table public.site_delivery_locations
  add column if not exists billing_address_id uuid references public.company_billing_addresses(id) on delete restrict;

create index if not exists site_delivery_locations_billing_address_idx
  on public.site_delivery_locations(billing_address_id, status);

create or replace function public.validate_site_delivery_location_billing_scope()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.billing_address_id is not null and not exists (
    select 1
    from public.company_billing_addresses b
    join public.companies c on c.id = b.company_id
    join public.sites s on s.id = new.site_id
    where b.id = new.billing_address_id
      and b.organization_id = new.organization_id
      and c.organization_id = b.organization_id
      and s.organization_id = new.organization_id
      and (s.company_id is null or s.company_id = b.company_id)
  ) then
    raise exception 'Delivery location billing parent does not match its organization and site';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_validate_site_delivery_location_billing_scope
  on public.site_delivery_locations;

create trigger trg_validate_site_delivery_location_billing_scope
before insert or update of billing_address_id, organization_id, site_id
on public.site_delivery_locations
for each row
execute function public.validate_site_delivery_location_billing_scope();
