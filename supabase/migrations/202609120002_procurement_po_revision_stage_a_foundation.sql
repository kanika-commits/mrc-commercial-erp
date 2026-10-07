begin;

alter table public.procurement_purchase_orders
  add column if not exists revision_family_id uuid,
  add column if not exists root_purchase_order_id uuid,
  add column if not exists previous_revision_id uuid,
  add column if not exists superseded_by_revision_id uuid,
  add column if not exists revision_diff_snapshot jsonb;

alter table public.procurement_purchase_order_items
  add column if not exists revision_line_key uuid;

update public.procurement_purchase_order_items
set revision_line_key = gen_random_uuid()
where revision_line_key is null;

create unique index if not exists procurement_po_revision_family_no_uidx
  on public.procurement_purchase_orders(organization_id, revision_family_id, revision_no)
  where revision_family_id is not null;
create index if not exists procurement_po_revision_family_idx
  on public.procurement_purchase_orders(organization_id, revision_family_id, revision_no, status);
create index if not exists procurement_po_revision_root_idx
  on public.procurement_purchase_orders(root_purchase_order_id);
create index if not exists procurement_po_revision_previous_idx
  on public.procurement_purchase_orders(previous_revision_id);
create index if not exists procurement_po_revision_item_lineage_idx
  on public.procurement_purchase_order_items(purchase_order_id, revision_line_key);

do $$ begin
  if not exists (select 1 from pg_constraint where conname='procurement_po_revision_root_fk') then
    alter table public.procurement_purchase_orders add constraint procurement_po_revision_root_fk foreign key (root_purchase_order_id) references public.procurement_purchase_orders(id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname='procurement_po_revision_previous_fk') then
    alter table public.procurement_purchase_orders add constraint procurement_po_revision_previous_fk foreign key (previous_revision_id) references public.procurement_purchase_orders(id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname='procurement_po_revision_superseded_fk') then
    alter table public.procurement_purchase_orders add constraint procurement_po_revision_superseded_fk foreign key (superseded_by_revision_id) references public.procurement_purchase_orders(id) on delete restrict;
  end if;
end $$;

create or replace function public.procurement_purchase_order_effective_revision(p_purchase_order_id uuid)
returns public.procurement_purchase_orders
language sql stable security definer set search_path = public, pg_temp
as $$
  select po.*
  from public.procurement_purchase_orders po
  cross join public.procurement_purchase_orders source
  where po.id = coalesce(
    (select candidate.id
       from public.procurement_purchase_orders candidate
      where candidate.organization_id = source.organization_id
        and ((source.revision_family_id is null and candidate.id = source.id)
          or (source.revision_family_id is not null and candidate.revision_family_id = source.revision_family_id))
        and candidate.status in ('approved','issued')
        and candidate.superseded_by_revision_id is null
      order by candidate.revision_no desc, candidate.created_at desc
      limit 1), source.id)
    and source.id = p_purchase_order_id;
$$;

create or replace function public.procurement_purchase_order_received_by_lineage(p_organization_id uuid, p_purchase_order_id uuid, p_revision_line_key uuid)
returns numeric language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce(sum(coalesce(i.accepted_quantity,0)),0)
  from public.procurement_goods_receipt_items i
  join public.procurement_goods_receipts g on g.id=i.grn_id
  join public.procurement_purchase_order_items poi on poi.id=i.purchase_order_item_id
  join public.procurement_purchase_orders po on po.id=poi.purchase_order_id
  join public.procurement_purchase_orders source on source.id=p_purchase_order_id
  where po.organization_id=p_organization_id
    and source.organization_id=p_organization_id
    and ((source.revision_family_id is null and po.id=source.id)
      or (source.revision_family_id is not null and po.revision_family_id=source.revision_family_id))
    and poi.revision_line_key=p_revision_line_key
    and g.status='finalized';
$$;

create or replace function public.procurement_purchase_order_remaining_by_lineage(p_organization_id uuid, p_purchase_order_id uuid, p_revision_line_key uuid, p_effective_quantity numeric)
returns numeric language sql stable security definer set search_path = public, pg_temp
as $$
  select p_effective_quantity - public.procurement_purchase_order_received_by_lineage(p_organization_id,p_purchase_order_id,p_revision_line_key);
$$;

revoke all on function public.procurement_purchase_order_effective_revision(uuid), public.procurement_purchase_order_received_by_lineage(uuid,uuid,uuid), public.procurement_purchase_order_remaining_by_lineage(uuid,uuid,uuid,numeric) from public, anon, authenticated;
grant execute on function public.procurement_purchase_order_effective_revision(uuid), public.procurement_purchase_order_received_by_lineage(uuid,uuid,uuid), public.procurement_purchase_order_remaining_by_lineage(uuid,uuid,uuid,numeric) to service_role;

commit;
