-- Daily Wage Work Order contract. Prepared for manual application; do not execute as part of deployment.
-- This is limited to the existing MRC work_orders/work_order_items tables and service-side Pilot functions.
begin;

alter table public.work_orders
  add column if not exists pilot_vendor_id uuid,
  add column if not exists pilot_work_order_type text;

create index if not exists work_orders_pilot_scope_idx
  on public.work_orders (organization_id, company_id, site_id, pilot_vendor_id, pilot_work_order_type);

create or replace function public.validate_work_order_pilot_creation(
  p_organization_id uuid,
  p_company_id uuid,
  p_site_id uuid,
  p_vendor_id uuid,
  p_work_order_type text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_existing public.work_orders;
  v_type text := lower(regexp_replace(trim(coalesce(p_work_order_type, '')), '\s+', ' ', 'g'));
begin
  if v_type <> 'daily wage' then return '{}'::jsonb; end if;
  perform pg_advisory_xact_lock(hashtextextended(
    coalesce(p_organization_id::text, '') || ':' || coalesce(p_company_id::text, '') || ':' || coalesce(p_site_id::text, '') || ':' || coalesce(p_vendor_id::text, '') || ':daily wage', 0));
  select * into v_existing from public.work_orders
   where organization_id = p_organization_id and company_id = p_company_id and site_id = p_site_id and pilot_vendor_id = p_vendor_id
     and lower(regexp_replace(trim(coalesce(pilot_work_order_type, wo_type, '')), '\s+', ' ', 'g')) = 'daily wage'
     and creation_request_id is not null
     and lower(coalesce(status, '')) not in ('rejected','cancelled','canceled','voided')
     and lower(coalesce(approval_status, '')) not in ('rejected','cancelled','canceled','voided')
   order by created_at limit 1;
  if v_existing.id is null then return '{}'::jsonb; end if;
  return jsonb_build_object('existing_work_order_id', v_existing.id, 'existing_wo_number', v_existing.wo_number);
end; $$;

create or replace function public.enforce_work_order_pilot_vendor_type() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_duplicate public.work_orders;
  v_type text := lower(regexp_replace(trim(coalesce(new.pilot_work_order_type, new.wo_type, '')), '\s+', ' ', 'g'));
begin
  if new.creation_request_id is null or new.pilot_vendor_id is null or v_type <> 'daily wage' then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended(
    coalesce(new.organization_id::text, '') || ':' || coalesce(new.company_id::text, '') || ':' || coalesce(new.site_id::text, '') || ':' || new.pilot_vendor_id::text || ':daily wage', 0));
  select * into v_duplicate from public.work_orders
   where organization_id = new.organization_id and company_id = new.company_id and site_id = new.site_id and pilot_vendor_id = new.pilot_vendor_id
     and lower(regexp_replace(trim(coalesce(pilot_work_order_type, wo_type, '')), '\s+', ' ', 'g')) = 'daily wage'
     and creation_request_id is not null and id <> new.id
     and lower(coalesce(status, '')) not in ('rejected','cancelled','canceled','voided')
     and lower(coalesce(approval_status, '')) not in ('rejected','cancelled','canceled','voided') limit 1;
  if v_duplicate.id is not null then raise exception 'A live Daily Wage Work Order already exists for this vendor at this site: %.', coalesce(v_duplicate.wo_number, v_duplicate.id::text) using errcode = '23505'; end if;
  return new;
end; $$;

drop trigger if exists work_orders_pilot_vendor_type_guard on public.work_orders;
create trigger work_orders_pilot_vendor_type_guard
before insert or update of pilot_vendor_id, pilot_work_order_type, status, approval_status
on public.work_orders for each row execute function public.enforce_work_order_pilot_vendor_type();

revoke all on function public.validate_work_order_pilot_creation(uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.enforce_work_order_pilot_vendor_type() from public, anon, authenticated;
grant execute on function public.validate_work_order_pilot_creation(uuid, uuid, uuid, uuid, text) to service_role;
grant execute on function public.enforce_work_order_pilot_vendor_type() to service_role;

commit;
