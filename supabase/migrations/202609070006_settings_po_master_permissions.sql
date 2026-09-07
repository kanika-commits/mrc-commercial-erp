begin;

insert into public.erp_modules (module_group, module_code, module_name, route, sort_order, status)
select 'settings', v.module_code, v.module_name, v.route, v.sort_order, 'active'
from (values
  ('procurement_gst_billing_delivery_master', 'Masters - GST / Billing & Delivery', '/settings/purchase-order-masters?master=billing-delivery', 60),
  ('procurement_site_contact_master', 'Masters - Site Contacts', '/settings/purchase-order-masters/site-contacts', 61),
  ('procurement_letterhead_master', 'Masters - Letterheads', '/settings/purchase-order-masters/letterheads', 62),
  ('procurement_po_terms_master', 'Masters - PO Terms & Conditions', '/settings/purchase-order-masters', 63)
) v(module_code, module_name, route, sort_order)
where not exists (select 1 from public.erp_modules m where m.module_code = v.module_code);

insert into public.role_permissions (role_id, module_code, action_code, allowed)
select r.id, p.module_code, p.action_code, true
from public.roles r
cross join (values
  ('procurement_gst_billing_delivery_master', 'view'),
  ('procurement_gst_billing_delivery_master', 'add'),
  ('procurement_gst_billing_delivery_master', 'edit'),
  ('procurement_site_contact_master', 'view'),
  ('procurement_site_contact_master', 'add'),
  ('procurement_site_contact_master', 'edit'),
  ('procurement_letterhead_master', 'view'),
  ('procurement_letterhead_master', 'add'),
  ('procurement_letterhead_master', 'edit'),
  ('procurement_letterhead_master', 'delete'),
  ('procurement_po_terms_master', 'view'),
  ('procurement_po_terms_master', 'add'),
  ('procurement_po_terms_master', 'edit')
) p(module_code, action_code)
where r.role_code in ('platform_owner', 'super_admin')
  and not exists (
    select 1 from public.role_permissions existing
    where existing.role_id = r.id
      and existing.module_code = p.module_code
      and existing.action_code = p.action_code
  );

commit;
