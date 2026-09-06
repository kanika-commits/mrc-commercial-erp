begin;

create table if not exists public.procurement_inventory_balances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  company_id uuid not null references public.companies(id),
  site_id uuid not null references public.sites(id),
  stock_identity_key text not null,
  material_item_id uuid references public.procurement_items(id),
  source_purchase_order_item_id uuid references public.procurement_purchase_order_items(id),
  item_code_snapshot text,
  item_name_snapshot text not null,
  specification_snapshot text,
  make_snapshot text,
  uom_snapshot text not null,
  quantity_on_hand numeric(14,3) not null default 0 check (quantity_on_hand >= 0),
  total_received numeric(14,3) not null default 0 check (total_received >= 0),
  total_issued numeric(14,3) not null default 0 check (total_issued >= 0),
  last_movement_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint procurement_inventory_balances_identity_uidx unique (organization_id, company_id, site_id, stock_identity_key)
);

create table if not exists public.procurement_inventory_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  company_id uuid not null references public.companies(id),
  site_id uuid not null references public.sites(id),
  stock_identity_key text not null,
  inventory_balance_id uuid not null references public.procurement_inventory_balances(id),
  material_item_id uuid references public.procurement_items(id),
  source_purchase_order_item_id uuid references public.procurement_purchase_order_items(id),
  item_code_snapshot text,
  item_name_snapshot text not null,
  specification_snapshot text,
  make_snapshot text,
  uom_snapshot text not null,
  movement_type text not null check (movement_type in ('receipt_accepted', 'material_issue')),
  quantity_in numeric(14,3) not null default 0 check (quantity_in >= 0),
  quantity_out numeric(14,3) not null default 0 check (quantity_out >= 0),
  source_type text not null check (source_type in ('goods_receipt', 'material_issue')),
  source_id uuid not null,
  source_item_id uuid not null,
  movement_date date not null default current_date,
  actor_id uuid,
  actor_name text,
  actor_email text,
  created_at timestamptz not null default now(),
  constraint procurement_inventory_movements_one_direction check ((quantity_in > 0 and quantity_out = 0) or (quantity_out > 0 and quantity_in = 0)),
  constraint procurement_inventory_movements_source_uidx unique (source_type, source_item_id, movement_type)
);

create table if not exists public.procurement_material_issues (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  company_id uuid not null references public.companies(id),
  site_id uuid not null references public.sites(id),
  issue_number text not null,
  issue_date date not null default current_date,
  status text not null default 'draft' check (status in ('draft', 'finalized')),
  issued_to text not null,
  department text,
  work_location text,
  purpose text not null,
  remarks text,
  created_by uuid,
  created_by_name text,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_by_name text,
  updated_by_email text,
  updated_at timestamptz not null default now(),
  finalized_by uuid,
  finalized_by_name text,
  finalized_by_email text,
  finalized_at timestamptz,
  constraint procurement_material_issues_number_uidx unique (organization_id, issue_number)
);

create table if not exists public.procurement_material_issue_items (
  id uuid primary key default gen_random_uuid(),
  material_issue_id uuid not null references public.procurement_material_issues(id) on delete cascade,
  inventory_balance_id uuid not null references public.procurement_inventory_balances(id),
  stock_identity_key text not null,
  material_item_id uuid references public.procurement_items(id),
  source_purchase_order_item_id uuid references public.procurement_purchase_order_items(id),
  item_code_snapshot text,
  item_name_snapshot text not null,
  specification_snapshot text,
  make_snapshot text,
  uom_snapshot text not null,
  available_quantity_snapshot numeric(14,3) not null check (available_quantity_snapshot >= 0),
  issue_quantity numeric(14,3) not null check (issue_quantity > 0),
  remarks text,
  created_at timestamptz not null default now(),
  constraint procurement_material_issue_items_unique unique (material_issue_id, inventory_balance_id)
);

create table if not exists public.procurement_material_issue_events (
  id uuid primary key default gen_random_uuid(),
  material_issue_id uuid not null references public.procurement_material_issues(id) on delete cascade,
  event_type text not null,
  event_note text,
  metadata jsonb not null default '{}'::jsonb,
  actor_id uuid,
  actor_name text,
  actor_email text,
  created_at timestamptz not null default now()
);

create sequence if not exists public.procurement_material_issue_number_seq;

create index if not exists procurement_inventory_balances_scope_idx on public.procurement_inventory_balances(organization_id, company_id, site_id, quantity_on_hand);
create index if not exists procurement_inventory_movements_balance_idx on public.procurement_inventory_movements(inventory_balance_id, movement_date, created_at, id);
create index if not exists procurement_inventory_movements_source_idx on public.procurement_inventory_movements(source_type, source_id);
create index if not exists procurement_material_issues_scope_idx on public.procurement_material_issues(organization_id, company_id, site_id, status, issue_date desc);
create index if not exists procurement_material_issue_items_issue_idx on public.procurement_material_issue_items(material_issue_id);
create index if not exists procurement_material_issue_events_issue_idx on public.procurement_material_issue_events(material_issue_id, created_at desc);

create or replace function public.next_procurement_material_issue_number(p_organization_id uuid, p_issue_date date)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return 'MI/' || to_char(p_issue_date, 'YYYY') || '/' || lpad(nextval('public.procurement_material_issue_number_seq')::text, 5, '0');
end;
$$;

create or replace function public.procurement_inventory_identity_key(p_material_item_id uuid, p_po_item_id uuid, p_uom text, p_make text, p_specification text)
returns text
language sql
immutable
as $$
  select case when p_material_item_id is not null then 'master:' || p_material_item_id::text else 'po_item:' || p_po_item_id::text end
    || ':' || md5(coalesce(lower(btrim(p_uom)), '') || chr(0) || coalesce(lower(btrim(p_make)), '') || chr(0) || coalesce(lower(btrim(p_specification)), ''));
$$;

create or replace function public.prevent_procurement_inventory_movement_mutation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  raise exception 'Inventory movement ledger is immutable.';
end;
$$;

drop trigger if exists trg_prevent_procurement_inventory_movement_mutation on public.procurement_inventory_movements;
create trigger trg_prevent_procurement_inventory_movement_mutation
before update or delete on public.procurement_inventory_movements
for each row execute function public.prevent_procurement_inventory_movement_mutation();

create or replace function public.post_procurement_inventory_receipt(p_grn_id uuid, p_actor jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  b public.procurement_inventory_balances%rowtype;
  v_movement_id uuid;
begin
  for r in
    select i.*, g.organization_id, g.company_id, g.site_id
      from public.procurement_goods_receipt_items i
      join public.procurement_goods_receipts g on g.id = i.grn_id
     where i.grn_id = p_grn_id and i.accepted_quantity > 0
     order by i.id
  loop
    insert into public.procurement_inventory_balances(
      organization_id, company_id, site_id, stock_identity_key, material_item_id,
      source_purchase_order_item_id, item_code_snapshot, item_name_snapshot,
      specification_snapshot, make_snapshot, uom_snapshot
    ) values (
      r.organization_id, r.company_id, r.site_id,
      public.procurement_inventory_identity_key(r.material_item_id, r.purchase_order_item_id, r.uom_snapshot, r.make_snapshot, r.specification_snapshot),
      r.material_item_id, r.purchase_order_item_id, r.item_code_snapshot, r.item_name_snapshot,
      r.specification_snapshot, r.make_snapshot, r.uom_snapshot
    ) on conflict (organization_id, company_id, site_id, stock_identity_key) do nothing;

    select * into b
      from public.procurement_inventory_balances
     where organization_id = r.organization_id
       and company_id = r.company_id
       and site_id = r.site_id
       and stock_identity_key = public.procurement_inventory_identity_key(r.material_item_id, r.purchase_order_item_id, r.uom_snapshot, r.make_snapshot, r.specification_snapshot)
     for update;

    insert into public.procurement_inventory_movements(
      organization_id, company_id, site_id, stock_identity_key, inventory_balance_id,
      material_item_id, source_purchase_order_item_id, item_code_snapshot, item_name_snapshot,
      specification_snapshot, make_snapshot, uom_snapshot, movement_type, quantity_in,
      source_type, source_id, source_item_id, movement_date, actor_id, actor_name, actor_email
    ) values (
      r.organization_id, r.company_id, r.site_id, b.stock_identity_key, b.id,
      r.material_item_id, r.purchase_order_item_id, r.item_code_snapshot, r.item_name_snapshot,
      r.specification_snapshot, r.make_snapshot, r.uom_snapshot, 'receipt_accepted', r.accepted_quantity,
      'goods_receipt', p_grn_id, r.id, current_date,
      nullif(p_actor->>'user_id', '')::uuid, p_actor->>'name', p_actor->>'email'
    ) on conflict (source_type, source_item_id, movement_type) do nothing returning id into v_movement_id;

    if v_movement_id is not null then
      update public.procurement_inventory_balances
         set quantity_on_hand = quantity_on_hand + r.accepted_quantity,
             total_received = total_received + r.accepted_quantity,
             last_movement_at = now(), updated_at = now()
       where id = b.id;
    end if;
  end loop;
end;
$$;

create or replace function public.trg_post_procurement_inventory_receipt()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.status is distinct from new.status and new.status = 'finalized' then
    perform public.post_procurement_inventory_receipt(new.id, jsonb_build_object('user_id', new.finalized_by::text, 'name', new.finalized_by_name, 'email', new.finalized_by_email));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_post_procurement_inventory_receipt on public.procurement_goods_receipts;
create trigger trg_post_procurement_inventory_receipt
after update of status on public.procurement_goods_receipts
for each row execute function public.trg_post_procurement_inventory_receipt();

create or replace function public.prevent_finalized_procurement_material_issue_mutation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_issue_id uuid;
begin
  if tg_table_name = 'procurement_material_issues' then
    if old.status = 'finalized' then raise exception 'Finalized Material Issues are immutable.'; end if;
  else
    if tg_op = 'DELETE' then v_issue_id := old.material_issue_id; else v_issue_id := new.material_issue_id; end if;
    if exists (select 1 from public.procurement_material_issues where id = v_issue_id and status = 'finalized') then
      raise exception 'Finalized Material Issues are immutable.';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists trg_lock_finalized_material_issues on public.procurement_material_issues;
create trigger trg_lock_finalized_material_issues
before update or delete on public.procurement_material_issues
for each row execute function public.prevent_finalized_procurement_material_issue_mutation();

drop trigger if exists trg_lock_finalized_material_issue_items on public.procurement_material_issue_items;
create trigger trg_lock_finalized_material_issue_items
before insert or update or delete on public.procurement_material_issue_items
for each row execute function public.prevent_finalized_procurement_material_issue_mutation();

create or replace function public.finalize_procurement_material_issue_atomic(p_issue_id uuid, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  h public.procurement_material_issues%rowtype;
  i record;
  b public.procurement_inventory_balances%rowtype;
  v_movement_id uuid;
begin
  select * into h from public.procurement_material_issues where id = p_issue_id for update;
  if not found then raise exception 'Material Issue was not found.'; end if;
  if h.status <> 'draft' then raise exception 'Only Draft Material Issues can be finalized.'; end if;
  if not exists (select 1 from public.procurement_material_issue_items where material_issue_id = p_issue_id) then
    raise exception 'At least one material issue item is required.';
  end if;

  for i in
    select ii.id as issue_item_id, ii.inventory_balance_id, ii.stock_identity_key,
           ii.material_item_id, ii.source_purchase_order_item_id, ii.item_code_snapshot,
           ii.item_name_snapshot, ii.specification_snapshot, ii.make_snapshot, ii.uom_snapshot,
           ii.issue_quantity, b.id as balance_id, b.organization_id as balance_organization_id,
           b.company_id as balance_company_id, b.site_id as balance_site_id,
           b.quantity_on_hand
      from public.procurement_material_issue_items ii
      join public.procurement_inventory_balances b on b.id = ii.inventory_balance_id
     where ii.material_issue_id = p_issue_id
     order by b.id, ii.id
     for update of b
  loop
    if i.balance_organization_id <> h.organization_id or i.balance_company_id <> h.company_id or i.balance_site_id <> h.site_id then
      raise exception 'Material Issue item is outside the selected scope.';
    end if;
    if i.issue_quantity <= 0 then raise exception 'Issue quantity must be positive.'; end if;
    if i.quantity_on_hand < i.issue_quantity then raise exception 'Insufficient stock for %.', i.item_name_snapshot; end if;

    insert into public.procurement_inventory_movements(
      organization_id, company_id, site_id, stock_identity_key, inventory_balance_id,
      material_item_id, source_purchase_order_item_id, item_code_snapshot, item_name_snapshot,
      specification_snapshot, make_snapshot, uom_snapshot, movement_type, quantity_out,
      source_type, source_id, source_item_id, movement_date, actor_id, actor_name, actor_email
    ) values (
      h.organization_id, h.company_id, h.site_id, i.stock_identity_key, i.balance_id,
      i.material_item_id, i.source_purchase_order_item_id, i.item_code_snapshot, i.item_name_snapshot,
      i.specification_snapshot, i.make_snapshot, i.uom_snapshot, 'material_issue', i.issue_quantity,
      'material_issue', h.id, i.issue_item_id, current_date,
      nullif(p_actor->>'user_id', '')::uuid, p_actor->>'name', p_actor->>'email'
    ) on conflict (source_type, source_item_id, movement_type) do nothing returning id into v_movement_id;

    if v_movement_id is not null then
      update public.procurement_inventory_balances
         set quantity_on_hand = quantity_on_hand - i.issue_quantity,
             total_issued = total_issued + i.issue_quantity,
             last_movement_at = now(), updated_at = now()
       where id = i.balance_id;
    end if;
  end loop;

  update public.procurement_material_issues
     set status = 'finalized', finalized_by = nullif(p_actor->>'user_id', '')::uuid,
         finalized_by_name = p_actor->>'name', finalized_by_email = p_actor->>'email',
         finalized_at = now(), updated_at = now(), updated_by = nullif(p_actor->>'user_id', '')::uuid,
         updated_by_name = p_actor->>'name', updated_by_email = p_actor->>'email'
   where id = p_issue_id and status = 'draft';
  if not found then raise exception 'Only Draft Material Issues can be finalized.'; end if;

  insert into public.procurement_material_issue_events(material_issue_id, event_type, actor_id, actor_name, actor_email, metadata)
  values (p_issue_id, 'finalized', nullif(p_actor->>'user_id', '')::uuid, p_actor->>'name', p_actor->>'email', jsonb_build_object('status', 'finalized'));
  return jsonb_build_object('material_issue_id', p_issue_id, 'status', 'finalized');
end;
$$;

commit;
