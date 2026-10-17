-- Opt-in Purchase Order -> Debit Note contractor-recovery linkage. Prepare only.
alter table public.procurement_purchase_orders
  add column if not exists purpose text not null default 'General Purchase',
  add column if not exists recovery_work_order_id uuid references public.work_orders(id) on delete restrict;
alter table public.debit_notes
  add column if not exists source_purchase_order_id uuid references public.procurement_purchase_orders(id) on delete restrict,
  add column if not exists source_purchase_order_documents jsonb not null default '[]'::jsonb;
create unique index if not exists debit_notes_contractor_recovery_po_uidx
  on public.debit_notes(source_purchase_order_id)
  where source_purchase_order_id is not null
    and coalesce(is_deleted, false) = false
    and lower(coalesce(approval_status, '')) <> 'rejected';
create index if not exists procurement_purchase_orders_recovery_work_order_idx on public.procurement_purchase_orders(organization_id, recovery_work_order_id) where recovery_work_order_id is not null;
create unique index if not exists user_notifications_contractor_recovery_uidx
  on public.user_notifications(organization_id, recipient_user_id, notification_type, related_entity_type, related_entity_id)
  where notification_type = 'contractor_recovery_debit_note';

create or replace function public.sync_procurement_purchase_order_recovery_fields()
returns trigger
language plpgsql
as $$
begin
  new.purpose := coalesce(nullif(new.purpose, ''), nullif(new.commercial_snapshot->>'purpose', ''), 'General Purchase');
  if new.purpose = 'Standard' then
    new.purpose := 'General Purchase';
  end if;
  if new.purpose <> 'Recover from contractor' then
    new.recovery_work_order_id := null;
    return new;
  end if;
  new.recovery_work_order_id := coalesce(
    new.recovery_work_order_id,
    nullif(new.commercial_snapshot->>'recovery_work_order_id', '')::uuid
  );
  if new.recovery_work_order_id is null then
    raise exception 'A linked Work Order is required for contractor recovery Purchase Orders';
  end if;
  if not exists (
    select 1
    from public.work_orders wo
    where wo.id = new.recovery_work_order_id
      and wo.organization_id = new.organization_id
  ) then
    raise exception 'The recovery Work Order must belong to the Purchase Order organization';
  end if;
  return new;
end;
$$;

drop trigger if exists procurement_purchase_order_recovery_fields_sync on public.procurement_purchase_orders;
create trigger procurement_purchase_order_recovery_fields_sync
before insert or update of commercial_snapshot, purpose, recovery_work_order_id
on public.procurement_purchase_orders
for each row execute function public.sync_procurement_purchase_order_recovery_fields();
