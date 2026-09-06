create table if not exists public.procurement_item_types (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  type_code text not null,
  type_name text not null,
  status text not null default 'active' check (status in ('active', 'inactive', 'deleted')),
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint procurement_item_types_org_code_unique unique (organization_id, type_code)
);

create table if not exists public.procurement_item_groups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  item_type_id uuid not null references public.procurement_item_types(id) on delete restrict,
  group_code text not null,
  group_name text not null,
  status text not null default 'active' check (status in ('active', 'inactive', 'deleted')),
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint procurement_item_groups_org_code_unique unique (organization_id, group_code)
);

alter table public.procurement_items add column if not exists item_type_id uuid references public.procurement_item_types(id) on delete restrict;
alter table public.procurement_items add column if not exists item_group_id uuid references public.procurement_item_groups(id) on delete restrict;

create table if not exists public.procurement_site_item_approved_makes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  site_id uuid not null references public.sites(id) on delete restrict,
  item_id uuid not null references public.procurement_items(id) on delete restrict,
  make_name text not null,
  status text not null default 'active' check (status in ('active', 'inactive', 'deleted')),
  sort_order integer not null default 100,
  remarks text,
  created_by uuid,
  created_by_name text,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_by_name text,
  updated_by_email text,
  updated_at timestamptz not null default now()
);

create unique index if not exists procurement_site_item_makes_unique_idx
  on public.procurement_site_item_approved_makes (organization_id, site_id, item_id, lower(trim(make_name)))
  where status <> 'deleted';

create table if not exists public.purchase_requisition_item_approved_makes (
  id uuid primary key default gen_random_uuid(),
  requisition_item_id uuid not null references public.purchase_requisition_items(id) on delete restrict,
  make_name_snapshot text not null,
  sort_order integer not null default 1,
  created_at timestamptz not null default now()
);

create index if not exists procurement_item_groups_type_idx on public.procurement_item_groups (organization_id, item_type_id, status, sort_order);
create index if not exists procurement_items_type_group_idx on public.procurement_items (organization_id, item_type_id, item_group_id, status);
create index if not exists procurement_site_item_makes_lookup_idx on public.procurement_site_item_approved_makes (organization_id, site_id, item_id, status, sort_order);
create index if not exists purchase_req_item_makes_line_idx on public.purchase_requisition_item_approved_makes (requisition_item_id, sort_order);

alter table public.procurement_item_types enable row level security;
alter table public.procurement_item_groups enable row level security;
alter table public.procurement_site_item_approved_makes enable row level security;
alter table public.purchase_requisition_item_approved_makes enable row level security;

grant all on public.procurement_item_types to service_role;
grant all on public.procurement_item_groups to service_role;
grant all on public.procurement_site_item_approved_makes to service_role;
grant all on public.purchase_requisition_item_approved_makes to service_role;

with type_seed(type_code, type_name, sort_order) as (
  values
    ('RAW_MATERIAL', 'Raw Material', 10),
    ('STORE_SPARE', 'Store & Spare', 20),
    ('INPUT_CONSUMABLE', 'Input & Consumable', 30),
    ('FIXED_ASSET', 'Fixed Asset', 40),
    ('SERVICE', 'Service', 50)
)
insert into public.procurement_item_types (organization_id, type_code, type_name, sort_order)
select o.id, s.type_code, s.type_name, s.sort_order
from public.organizations o cross join type_seed s
on conflict (organization_id, type_code) do update set type_name = excluded.type_name, sort_order = excluded.sort_order, updated_at = now();

with group_seed(type_code, group_code, group_name, sort_order) as (
  values
    ('RAW_MATERIAL', 'CEMENT', 'Cement', 10),
    ('RAW_MATERIAL', 'STEEL', 'Steel', 20),
    ('RAW_MATERIAL', 'BRICKS', 'Bricks', 30),
    ('RAW_MATERIAL', 'READY_MIX_CONCRETE', 'Ready Mix Concrete', 40),
    ('RAW_MATERIAL', 'AGGREGATE', 'Aggregate', 50),
    ('STORE_SPARE', 'ELECTRICAL_MATERIAL', 'Electrical Material', 10),
    ('STORE_SPARE', 'PLUMBING_MATERIAL', 'Plumbing Material', 20),
    ('STORE_SPARE', 'HARDWARE', 'Hardware', 30),
    ('STORE_SPARE', 'SAFETY_MATERIAL', 'Safety Material', 40),
    ('STORE_SPARE', 'MACHINERY_SPARE_PARTS', 'Machinery & Spare Parts', 50),
    ('STORE_SPARE', 'FIRE_FIGHTING_MATERIAL', 'Fire Fighting Material', 60),
    ('STORE_SPARE', 'FALSE_CEILING', 'False Ceiling', 70),
    ('STORE_SPARE', 'TILES_MARBLE', 'Tiles & Marble', 80),
    ('STORE_SPARE', 'ALUMINIUM_MATERIAL', 'Aluminium Material', 90),
    ('INPUT_CONSUMABLE', 'FUEL', 'Fuel', 10),
    ('INPUT_CONSUMABLE', 'PAINT_VARNISH', 'Paint & Varnish', 20),
    ('INPUT_CONSUMABLE', 'MATERIAL_TESTING', 'Material Testing', 30),
    ('INPUT_CONSUMABLE', 'STATIONERY_MATERIAL', 'Stationery Material', 40),
    ('SERVICE', 'SERVICE', 'Service', 10)
)
insert into public.procurement_item_groups (organization_id, item_type_id, group_code, group_name, sort_order)
select o.id, t.id, g.group_code, g.group_name, g.sort_order
from public.organizations o
join public.procurement_item_types t on t.organization_id = o.id
join group_seed g on g.type_code = t.type_code
on conflict (organization_id, group_code) do update set item_type_id = excluded.item_type_id, group_name = excluded.group_name, sort_order = excluded.sort_order, updated_at = now();

update public.procurement_items i
set item_type_id = g.item_type_id,
    item_group_id = g.id,
    updated_at = now()
from public.procurement_item_groups g
where i.organization_id = g.organization_id
  and i.item_group_id is null
  and lower(trim(i.item_category)) = lower(trim(g.group_name));

update public.procurement_items i
set item_type_id = g.item_type_id,
    item_group_id = g.id,
    updated_at = now()
from public.procurement_item_groups g
where i.organization_id = g.organization_id
  and i.item_group_id is null
  and g.group_code = 'SERVICE';
