create extension if not exists pgcrypto;

create table if not exists public.procurement_uoms (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  uom_code text not null,
  uom_name text not null,
  status text not null default 'active' check (status in ('active', 'inactive', 'deleted')),
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint procurement_uoms_org_code_unique unique (organization_id, uom_code)
);

create table if not exists public.procurement_item_code_sequences (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  last_number bigint not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.procurement_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  item_code text not null,
  item_name text not null,
  item_category text not null default 'Other',
  default_uom_id uuid references public.procurement_uoms(id) on delete restrict,
  description text,
  hsn_sac text,
  status text not null default 'active' check (status in ('active', 'inactive', 'deleted')),
  created_by uuid,
  created_by_name text,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_by_name text,
  updated_by_email text,
  updated_at timestamptz not null default now(),
  constraint procurement_items_org_code_unique unique (organization_id, item_code)
);

create unique index if not exists procurement_items_org_name_uidx
  on public.procurement_items (organization_id, lower(trim(item_name)))
  where status <> 'deleted';

create table if not exists public.purchase_requisition_sequences (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  sequence_year integer not null,
  last_number bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (organization_id, site_id, sequence_year)
);

create table if not exists public.purchase_requisitions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  requisition_number text not null,
  requisition_date date not null default current_date,
  company_id uuid not null references public.companies(id) on delete restrict,
  site_id uuid not null references public.sites(id) on delete restrict,
  requested_by_user_id uuid,
  requested_by_name text,
  requested_by_email text,
  required_by_date date not null,
  priority text not null default 'Normal' check (priority in ('Normal', 'Urgent', 'Critical')),
  purpose text not null,
  remarks text,
  status text not null default 'draft' check (status in ('draft', 'pending_approval', 'approved', 'sent_back', 'rejected', 'deleted')),
  approval_status text not null default 'draft' check (approval_status in ('draft', 'pending', 'approved', 'sent_back', 'rejected')),
  submitted_at timestamptz,
  submitted_by uuid,
  submitted_by_name text,
  submitted_by_email text,
  approved_at timestamptz,
  approved_by uuid,
  approved_by_name text,
  approved_by_email text,
  sent_back_at timestamptz,
  sent_back_by uuid,
  sent_back_by_name text,
  sent_back_by_email text,
  sent_back_reason text,
  rejected_at timestamptz,
  rejected_by uuid,
  rejected_by_name text,
  rejected_by_email text,
  rejection_reason text,
  created_by uuid,
  created_by_name text,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_by_name text,
  updated_by_email text,
  updated_at timestamptz not null default now(),
  constraint purchase_requisitions_org_number_unique unique (organization_id, requisition_number)
);

create table if not exists public.purchase_requisition_items (
  id uuid primary key default gen_random_uuid(),
  requisition_id uuid not null references public.purchase_requisitions(id) on delete restrict,
  item_id uuid not null references public.procurement_items(id) on delete restrict,
  item_name_snapshot text not null,
  item_code_snapshot text not null,
  specification text,
  make_brand text,
  uom_id uuid not null references public.procurement_uoms(id) on delete restrict,
  uom_snapshot text not null,
  quantity numeric(14, 3) not null check (quantity > 0),
  required_by_date date,
  remarks text,
  sort_order integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.purchase_requisition_events (
  id uuid primary key default gen_random_uuid(),
  requisition_id uuid not null references public.purchase_requisitions(id) on delete restrict,
  event_type text not null,
  event_note text,
  from_status text,
  to_status text,
  created_by uuid,
  created_by_name text,
  created_by_email text,
  created_at timestamptz not null default now()
);

create index if not exists procurement_items_org_status_idx on public.procurement_items (organization_id, status, item_category);
create index if not exists purchase_requisitions_scope_status_idx on public.purchase_requisitions (organization_id, company_id, site_id, status, approval_status, created_at desc);
create index if not exists purchase_requisition_items_requisition_idx on public.purchase_requisition_items (requisition_id, sort_order);
create index if not exists purchase_requisition_events_requisition_idx on public.purchase_requisition_events (requisition_id, created_at desc);

create or replace function public.next_procurement_item_code(p_organization_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_number bigint;
begin
  if p_organization_id is null then
    raise exception 'Organization is required.';
  end if;

  insert into public.procurement_item_code_sequences (organization_id, last_number)
  values (p_organization_id, 1)
  on conflict (organization_id)
  do update set last_number = public.procurement_item_code_sequences.last_number + 1, updated_at = now()
  returning last_number into v_number;

  return 'MAT' || lpad(v_number::text, 6, '0');
end;
$$;

create or replace function public.next_purchase_requisition_number(p_organization_id uuid, p_site_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year integer := extract(year from current_date)::integer;
  v_number bigint;
  v_site_code text;
begin
  if p_organization_id is null or p_site_id is null then
    raise exception 'Organization and site are required.';
  end if;

  select upper(regexp_replace(coalesce(site_code, 'SITE'), '[^A-Za-z0-9]+', '', 'g'))
    into v_site_code
  from public.sites
  where id = p_site_id and organization_id = p_organization_id;

  if v_site_code is null or v_site_code = '' then
    raise exception 'Site was not found for requisition numbering.';
  end if;

  insert into public.purchase_requisition_sequences (organization_id, site_id, sequence_year, last_number)
  values (p_organization_id, p_site_id, v_year, 1)
  on conflict (organization_id, site_id, sequence_year)
  do update set last_number = public.purchase_requisition_sequences.last_number + 1, updated_at = now()
  returning last_number into v_number;

  return v_site_code || '/PR/' || v_year::text || '/' || lpad(v_number::text, 4, '0');
end;
$$;

revoke all on function public.next_procurement_item_code(uuid) from public;
revoke all on function public.next_procurement_item_code(uuid) from anon;
revoke all on function public.next_procurement_item_code(uuid) from authenticated;
grant execute on function public.next_procurement_item_code(uuid) to service_role;

revoke all on function public.next_purchase_requisition_number(uuid, uuid) from public;
revoke all on function public.next_purchase_requisition_number(uuid, uuid) from anon;
revoke all on function public.next_purchase_requisition_number(uuid, uuid) from authenticated;
grant execute on function public.next_purchase_requisition_number(uuid, uuid) to service_role;

alter table public.procurement_uoms enable row level security;
alter table public.procurement_item_code_sequences enable row level security;
alter table public.procurement_items enable row level security;
alter table public.purchase_requisition_sequences enable row level security;
alter table public.purchase_requisitions enable row level security;
alter table public.purchase_requisition_items enable row level security;
alter table public.purchase_requisition_events enable row level security;

grant all on public.procurement_uoms to service_role;
grant all on public.procurement_item_code_sequences to service_role;
grant all on public.procurement_items to service_role;
grant all on public.purchase_requisition_sequences to service_role;
grant all on public.purchase_requisitions to service_role;
grant all on public.purchase_requisition_items to service_role;
grant all on public.purchase_requisition_events to service_role;

insert into public.erp_modules (module_group, module_code, module_name, route, sort_order, status)
values
  ('settings', 'procurement_items', 'Item / Material Master', '/settings/items', 75, 'active'),
  ('purchase', 'purchase_requisitions', 'Purchase Requisition', '/purchase/requisitions', 30, 'active'),
  ('purchase', 'purchase_requisition_approval', 'Requisition Approval', '/purchase/requisitions/approvals', 40, 'active')
on conflict (module_code) do update set
  module_group = excluded.module_group,
  module_name = excluded.module_name,
  route = excluded.route,
  sort_order = excluded.sort_order,
  status = excluded.status;

with module_actions(module_code, action_code) as (
  values
    ('procurement_items', 'view'), ('procurement_items', 'add'), ('procurement_items', 'edit'), ('procurement_items', 'delete'), ('procurement_items', 'export'),
    ('purchase_requisitions', 'view'), ('purchase_requisitions', 'add'), ('purchase_requisitions', 'edit'), ('purchase_requisitions', 'delete'), ('purchase_requisitions', 'submit'), ('purchase_requisitions', 'export'),
    ('purchase_requisition_approval', 'view'), ('purchase_requisition_approval', 'approve'), ('purchase_requisition_approval', 'reject')
)
insert into public.role_permissions (role_id, module_code, action_code, allowed)
select r.id, ma.module_code, ma.action_code, true
from public.roles r
cross join module_actions ma
where r.role_code in ('platform_owner', 'super_admin')
  and not exists (
    select 1 from public.role_permissions rp
    where rp.role_id = r.id and rp.module_code = ma.module_code and rp.action_code = ma.action_code
  );

insert into public.procurement_uoms (organization_id, uom_code, uom_name, sort_order)
select o.id, seed.uom_code, seed.uom_name, seed.sort_order
from public.organizations o
cross join (values
  ('Nos', 'Numbers', 10),
  ('Kg', 'Kilogram', 20),
  ('MT', 'Metric Ton', 30),
  ('Bag', 'Bag', 40),
  ('Ltr', 'Litre', 50),
  ('Mtr', 'Metre', 60),
  ('Sqm', 'Square Metre', 70),
  ('Sqft', 'Square Feet', 80),
  ('Cum', 'Cubic Metre', 90),
  ('Set', 'Set', 100),
  ('Pair', 'Pair', 110),
  ('Box', 'Box', 120),
  ('Roll', 'Roll', 130),
  ('Lot', 'Lot', 140),
  ('Day', 'Day', 150),
  ('Month', 'Month', 160)
) as seed(uom_code, uom_name, sort_order)
on conflict (organization_id, uom_code) do update set
  uom_name = excluded.uom_name,
  sort_order = excluded.sort_order,
  updated_at = now();
