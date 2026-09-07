begin;

insert into public.erp_modules (
  module_group,
  module_code,
  module_name,
  route,
  sort_order,
  status
)
select
  'store_management',
  'procurement_goods_receipts',
  'Purchase Order Tracking',
  '/store/goods-receipts',
  7,
  'active'
where not exists (
  select 1
  from public.erp_modules
  where module_code = 'procurement_goods_receipts'
);

insert into public.role_permissions (
  role_id,
  module_code,
  action_code,
  allowed
)
select
  inventory_permissions.role_id,
  'procurement_goods_receipts',
  inventory_permissions.action_code,
  true
from public.role_permissions inventory_permissions
where inventory_permissions.module_code = 'procurement_inventory'
  and inventory_permissions.allowed = true
  and inventory_permissions.action_code in (
    'view',
    'add',
    'edit',
    'approve',
    'export'
  )
  and not exists (
    select 1
    from public.role_permissions existing
    where existing.role_id = inventory_permissions.role_id
      and existing.module_code = 'procurement_goods_receipts'
      and existing.action_code = inventory_permissions.action_code
  );

commit;
