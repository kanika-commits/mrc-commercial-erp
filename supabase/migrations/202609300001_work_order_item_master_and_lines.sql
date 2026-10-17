-- Prepared only: do not apply without review.
-- Additive Work Order Item Master and immutable line snapshots.

begin;

create table if not exists public.work_order_item_masters (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  item_header text not null check (length(btrim(item_header)) > 0),
  description text,
  unit text not null check (length(btrim(unit)) > 0),
  mode_of_measurement text not null check (length(btrim(mode_of_measurement)) > 0),
  status text not null default 'active' check (status in ('active', 'inactive', 'deleted')),
  created_by uuid references public.profiles(id) on delete set null,
  created_by_name text,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_by_name text,
  updated_by_email text,
  updated_at timestamptz not null default now()
);

create table if not exists public.work_order_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  work_order_id uuid not null references public.work_orders(id) on delete restrict,
  item_master_id uuid not null references public.work_order_item_masters(id) on delete restrict,
  item_header_snapshot text not null,
  description_snapshot text,
  unit_snapshot text not null,
  mode_of_measurement_snapshot text not null,
  sort_order integer not null default 1 check (sort_order > 0),
  created_by uuid references public.profiles(id) on delete set null,
  created_by_name text,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_by_name text,
  updated_by_email text,
  updated_at timestamptz not null default now(),
  constraint work_order_items_work_order_sort_uidx unique (work_order_id, sort_order)
);

create index if not exists work_order_item_masters_scope_idx
  on public.work_order_item_masters (organization_id, status, item_header);
create unique index if not exists work_order_item_masters_org_header_uidx
  on public.work_order_item_masters (organization_id, lower(btrim(item_header)));
create index if not exists work_order_items_work_order_idx
  on public.work_order_items (work_order_id, sort_order);
create index if not exists work_order_items_master_idx
  on public.work_order_items (organization_id, item_master_id);

alter table public.work_order_item_masters enable row level security;
alter table public.work_order_items enable row level security;
revoke all on table public.work_order_item_masters, public.work_order_items from public, anon, authenticated;
grant all on table public.work_order_item_masters, public.work_order_items to service_role;

commit;
