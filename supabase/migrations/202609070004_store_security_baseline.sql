begin;

alter table public.procurement_goods_receipts enable row level security;
alter table public.procurement_goods_receipt_items enable row level security;
alter table public.procurement_goods_receipt_events enable row level security;
alter table public.procurement_goods_receipt_documents enable row level security;
alter table public.procurement_goods_receipt_verified_values enable row level security;
alter table public.procurement_inventory_balances enable row level security;
alter table public.procurement_inventory_movements enable row level security;
alter table public.procurement_material_issues enable row level security;
alter table public.procurement_material_issue_items enable row level security;
alter table public.procurement_material_issue_events enable row level security;

revoke all on table
  public.procurement_goods_receipts,
  public.procurement_goods_receipt_items,
  public.procurement_goods_receipt_events,
  public.procurement_goods_receipt_documents,
  public.procurement_goods_receipt_verified_values,
  public.procurement_inventory_balances,
  public.procurement_inventory_movements,
  public.procurement_material_issues,
  public.procurement_material_issue_items,
  public.procurement_material_issue_events
from public, anon, authenticated;

grant all on table
  public.procurement_goods_receipts,
  public.procurement_goods_receipt_items,
  public.procurement_goods_receipt_events,
  public.procurement_goods_receipt_documents,
  public.procurement_goods_receipt_verified_values,
  public.procurement_inventory_balances,
  public.procurement_inventory_movements,
  public.procurement_material_issues,
  public.procurement_material_issue_items,
  public.procurement_material_issue_events
to service_role;

revoke all on function public.next_procurement_goods_receipt_number(uuid, date) from public, anon, authenticated;
revoke all on function public.recalculate_goods_receipt_weight_reconciliation(uuid) from public, anon, authenticated;
revoke all on function public.refresh_goods_receipt_weight_reconciliation_from_verified_value() from public, anon, authenticated;
revoke all on function public.reconcile_goods_receipt_item_weight() from public, anon, authenticated;
revoke all on function public.prevent_finalized_goods_receipt_mutation() from public, anon, authenticated;
revoke all on function public.finalize_procurement_goods_receipt_atomic(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.next_procurement_material_issue_number(uuid, date) from public, anon, authenticated;
revoke all on function public.procurement_inventory_identity_key(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.prevent_procurement_inventory_movement_mutation() from public, anon, authenticated;
revoke all on function public.post_procurement_inventory_receipt(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.trg_post_procurement_inventory_receipt() from public, anon, authenticated;
revoke all on function public.prevent_finalized_procurement_material_issue_mutation() from public, anon, authenticated;
revoke all on function public.finalize_procurement_material_issue_atomic(uuid, jsonb) from public, anon, authenticated;

grant execute on function public.next_procurement_goods_receipt_number(uuid, date) to service_role;
grant execute on function public.finalize_procurement_goods_receipt_atomic(uuid, jsonb) to service_role;
grant execute on function public.next_procurement_material_issue_number(uuid, date) to service_role;
grant execute on function public.finalize_procurement_material_issue_atomic(uuid, jsonb) to service_role;

insert into public.erp_modules(module_group, module_code, module_name, route, sort_order, status)
select 'store_management', 'procurement_goods_receipts', 'Purchase Order Tracking', '/store/goods-receipts', 7, 'active'
where not exists (select 1 from public.erp_modules where module_code = 'procurement_goods_receipts');

insert into public.erp_modules(module_group, module_code, module_name, route, sort_order, status)
select 'store_management', 'procurement_inventory', 'Inventory', '/store/inventory', 8, 'active'
where not exists (select 1 from public.erp_modules where module_code = 'procurement_inventory');

insert into public.role_permissions(role_id, module_code, action_code, allowed)
select r.id, m.module_code, a.action_code, true
  from public.roles r
  cross join (values ('procurement_goods_receipts'), ('procurement_inventory')) m(module_code)
  cross join (values ('view'), ('add'), ('edit'), ('approve'), ('export')) a(action_code)
 where not exists (
   select 1 from public.role_permissions p
    where p.role_id = r.id and p.module_code = m.module_code and p.action_code = a.action_code
 );

insert into storage.buckets(id, name, public)
values ('procurement-rfq-quotation-documents', 'procurement-rfq-quotation-documents', false)
on conflict (id) do update set public = false;

commit;
