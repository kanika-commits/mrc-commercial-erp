begin;

-- Keep the generic Item / Material Master permission separate from Work Order Item Master.
insert into public.erp_modules (module_group, module_code, module_name, route, sort_order, status)
values ('settings', 'work_order_item_master', 'Masters - Work Order Item Master', '/work-orders/item-masters', 79, 'active')
on conflict (module_code) do update
set module_group = excluded.module_group,
    module_name = excluded.module_name,
    route = excluded.route,
    sort_order = excluded.sort_order,
    status = excluded.status;

commit;
