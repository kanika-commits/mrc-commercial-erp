-- Pilot-only approved RA Bill soft deletion. Prepare only; do not apply automatically.
alter table public.work_order_pilot_ra_bills
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid,
  add column if not exists deletion_reason text,
  add column if not exists deleted_from_status text;

create table if not exists public.work_order_pilot_ra_bill_deletion_audit (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  ra_bill_id uuid not null references public.work_order_pilot_ra_bills(id),
  actor_id uuid not null,
  deleted_at timestamptz not null default now(),
  reason text not null,
  prior_status text not null,
  unique (ra_bill_id)
);
create index if not exists work_order_pilot_ra_bill_deletion_audit_org_idx
  on public.work_order_pilot_ra_bill_deletion_audit(organization_id, deleted_at desc);
grant all on public.work_order_pilot_ra_bill_deletion_audit to service_role;

create or replace function public.soft_delete_work_order_pilot_ra_bill(p_id uuid, p_actor uuid, p_reason text)
returns public.work_order_pilot_ra_bills
language plpgsql security definer set search_path = public as $$
declare result public.work_order_pilot_ra_bills;
begin
  if trim(coalesce(p_reason, '')) = '' then raise exception 'A deletion reason is required'; end if;
  update public.work_order_pilot_ra_bills
    set deleted_at = coalesce(deleted_at, now()), deleted_by = coalesce(deleted_by, p_actor), deletion_reason = coalesce(deletion_reason, trim(p_reason)), deleted_from_status = coalesce(deleted_from_status, status), updated_at = now()
    where id = p_id and status = 'approved' and deleted_at is null
      and exists (
        select 1
        from public.work_orders wo
        where wo.id = work_order_pilot_ra_bills.work_order_id
          and wo.organization_id = work_order_pilot_ra_bills.organization_id
          and wo.creation_request_id is not null
      )
    returning * into result;
  if result.id is null then
    select bill.* into result
      from public.work_order_pilot_ra_bills bill
      join public.work_orders wo on wo.id = bill.work_order_id
        and wo.organization_id = bill.organization_id
        and wo.creation_request_id is not null
      where bill.id = p_id and bill.status = 'approved' and bill.deleted_at is not null;
    if result.id is null then raise exception 'Only an approved Pilot RA Bill can be soft-deleted'; end if;
    return result;
  end if;
  insert into public.work_order_pilot_ra_bill_deletion_audit(organization_id, ra_bill_id, actor_id, reason, prior_status)
    values (result.organization_id, result.id, p_actor, trim(p_reason), result.deleted_from_status)
    on conflict (ra_bill_id) do nothing;
  return result;
end; $$;
revoke all on function public.soft_delete_work_order_pilot_ra_bill(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.soft_delete_work_order_pilot_ra_bill(uuid, uuid, text) to service_role;
