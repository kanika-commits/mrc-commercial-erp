-- Original R-0 live-master refresh and atomic submit/resubmit freeze.
-- Terms/templates remain snapshot-backed. Revisions continue using the existing
-- five-argument transition function and never enter this wrapper.
begin;

alter table public.procurement_purchase_order_items
  add column if not exists item_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'procurement_purchase_order_items_item_id_fkey'
      and conrelid = 'public.procurement_purchase_order_items'::regclass
  ) then
    alter table public.procurement_purchase_order_items
      add constraint procurement_purchase_order_items_item_id_fkey
      foreign key (item_id) references public.procurement_items(id) on delete restrict;
  end if;
end;
$$;

create index if not exists procurement_purchase_order_items_item_id_idx
  on public.procurement_purchase_order_items(item_id);

-- Safe historical backfill: only active, organization-scoped, exact-code matches
-- with one candidate are linked. Blank/custom/ambiguous codes remain NULL.
with candidates as (
  select
    poi.id as po_item_id,
    i.id as item_id,
    count(*) over (partition by po.organization_id, poi.item_code_snapshot) as candidate_count
  from public.procurement_purchase_order_items poi
  join public.procurement_purchase_orders po on po.id = poi.purchase_order_id
  join public.procurement_items i
    on i.organization_id = po.organization_id
   and i.item_code = poi.item_code_snapshot
   and i.status = 'active'
  where poi.item_id is null
    and nullif(btrim(poi.item_code_snapshot), '') is not null
)
update public.procurement_purchase_order_items poi
set item_id = candidates.item_id
from candidates
where poi.id = candidates.po_item_id
  and candidates.candidate_count = 1;

create or replace function public.populate_procurement_purchase_order_item_master_id()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_organization_id uuid;
  v_item_id uuid;
  v_count integer;
begin
  if new.item_id is not null then return new; end if;
  if nullif(btrim(new.item_code_snapshot), '') is null then return new; end if;

  select po.organization_id into v_organization_id
  from public.procurement_purchase_orders po
  where po.id = new.purchase_order_id;

  select count(*), min(i.id)
    into v_count, v_item_id
  from public.procurement_items i
  where i.organization_id = v_organization_id
    and i.status = 'active'
    and i.item_code = new.item_code_snapshot
    and i.item_name = new.item_name_snapshot;

  if v_count = 1 then new.item_id := v_item_id; end if;
  return new;
end;
$$;

drop trigger if exists procurement_purchase_order_items_master_id_trigger
  on public.procurement_purchase_order_items;
create trigger procurement_purchase_order_items_master_id_trigger
before insert or update of item_code_snapshot, item_id
on public.procurement_purchase_order_items
for each row execute function public.populate_procurement_purchase_order_item_master_id();

create or replace function public.transition_procurement_purchase_order_atomic(
  p_purchase_order_id uuid,
  p_organization_id uuid,
  p_action text,
  p_actor jsonb,
  p_note text default null::text,
  p_freeze_projection jsonb default null::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_po public.procurement_purchase_orders%rowtype;
  v_item jsonb;
  v_item_id uuid;
  v_identity jsonb := coalesce(p_freeze_projection->'_identity', '{}'::jsonb);
begin
  if p_action = 'submit' and p_freeze_projection is not null then
    select * into v_po
      from public.procurement_purchase_orders
     where id = p_purchase_order_id
       and organization_id = p_organization_id
     for update;

    if not found then raise exception 'Purchase Order was not found.'; end if;
    if v_po.revision_no <> 0 or v_po.previous_revision_id is not null then
      raise exception 'Live master freezing is available only for the original R-0 Purchase Order.';
    end if;
    if v_po.status not in ('draft', 'sent_back') then
      raise exception 'Only Draft or Sent Back Purchase Orders can freeze live masters.';
    end if;
    if nullif(v_identity->>'company_id', '')::uuid is distinct from v_po.company_id
       or nullif(v_identity->>'site_id', '')::uuid is distinct from v_po.site_id
       or nullif(v_identity->>'vendor_id', '')::uuid is distinct from v_po.vendor_id then
      raise exception 'Purchase Order master identity changed while it was being submitted.';
    end if;

    if p_freeze_projection->'vendor_snapshot' is null
       or p_freeze_projection->'delivery_snapshot' is null then
      raise exception 'The current Purchase Order master projection is incomplete.';
    end if;

    update public.procurement_purchase_orders
       set vendor_name_snapshot = p_freeze_projection->>'vendor_name_snapshot',
           vendor_snapshot = p_freeze_projection->'vendor_snapshot',
           delivery_snapshot = p_freeze_projection->'delivery_snapshot'
     where id = v_po.id;

    for v_item in select value from jsonb_array_elements(coalesce(p_freeze_projection->'items', '[]'::jsonb)) loop
      v_item_id := nullif(v_item->>'id', '')::uuid;
      if v_item_id is not null then
        update public.procurement_purchase_order_items
           set item_code_snapshot = coalesce(v_item->>'item_code_snapshot', item_code_snapshot),
               item_name_snapshot = coalesce(nullif(v_item->>'item_name_snapshot', ''), item_name_snapshot),
               uom_snapshot = coalesce(nullif(v_item->>'uom_snapshot', ''), uom_snapshot)
         where id = v_item_id
           and purchase_order_id = v_po.id
           and item_id is not null;
        if not found then raise exception 'A linked Purchase Order item could not be frozen.'; end if;
      end if;
    end loop;
  end if;

  return public.transition_procurement_purchase_order_atomic(
    p_purchase_order_id, p_organization_id, p_action, p_actor, p_note
  );
end;
$$;

revoke all on function public.transition_procurement_purchase_order_atomic(uuid,uuid,text,jsonb,text,jsonb) from public, anon, authenticated;
grant execute on function public.transition_procurement_purchase_order_atomic(uuid,uuid,text,jsonb,text,jsonb) to service_role;

revoke all on function public.populate_procurement_purchase_order_item_master_id() from public, anon, authenticated;
grant execute on function public.populate_procurement_purchase_order_item_master_id() to service_role;

commit;
