-- Additive contractor-recovery vendor identity. The ordinary PO vendor remains unchanged.
alter table public.procurement_purchase_orders
  add column if not exists recovery_vendor_id uuid references public.vendors(id) on delete restrict;

create index if not exists procurement_purchase_orders_recovery_vendor_idx
  on public.procurement_purchase_orders(organization_id, recovery_vendor_id)
  where recovery_vendor_id is not null;

create or replace function public.sync_procurement_purchase_order_recovery_fields()
returns trigger
language plpgsql
as $$
begin
  new.purpose := coalesce(nullif(new.purpose, ''), nullif(new.commercial_snapshot->>'purpose', ''), 'General Purchase');
  if new.purpose = 'Standard' then new.purpose := 'General Purchase'; end if;
  if new.purpose <> 'Recover from contractor' then
    new.recovery_work_order_id := null;
    new.recovery_vendor_id := null;
    return new;
  end if;
  new.recovery_work_order_id := coalesce(new.recovery_work_order_id, nullif(new.commercial_snapshot->>'recovery_work_order_id', '')::uuid);
  new.recovery_vendor_id := coalesce(new.recovery_vendor_id, nullif(new.commercial_snapshot->>'recovery_vendor_id', '')::uuid);
  if new.recovery_work_order_id is null or new.recovery_vendor_id is null then
    raise exception 'A recovery vendor and linked Work Order are required for contractor recovery Purchase Orders';
  end if;
  if not exists (
    select 1 from public.work_orders wo
    where wo.id = new.recovery_work_order_id
      and wo.organization_id = new.organization_id
      and wo.company_id = new.company_id
      and wo.site_id = new.site_id
  ) then raise exception 'The recovery Work Order must match the Purchase Order organization, company and site'; end if;
  if not exists (
    select 1 from public.work_order_vendors wv
    where wv.work_order_id = new.recovery_work_order_id
      and wv.vendor_id = new.recovery_vendor_id
      and wv.vendor_role in ('Main Contractor', 'Subcontractor')
  ) then raise exception 'The recovery Work Order must be linked to the selected recovery vendor'; end if;
  return new;
end;
$$;

-- Replace the earlier recovery trigger so updates that only change the selected
-- recovery vendor are validated by the same function and scope checks.
drop trigger if exists procurement_purchase_order_recovery_fields_sync on public.procurement_purchase_orders;
create trigger procurement_purchase_order_recovery_fields_sync
before insert or update of commercial_snapshot, purpose, recovery_work_order_id, recovery_vendor_id
on public.procurement_purchase_orders
for each row execute function public.sync_procurement_purchase_order_recovery_fields();
