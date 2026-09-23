begin;

alter table public.payments
  add column if not exists site_id uuid,
  add column if not exists purchase_order_id uuid;

do $$
declare
  v_site_attnum smallint;
  v_po_attnum smallint;
  v_site_id_attnum smallint;
  v_po_id_attnum smallint;
begin
  select attnum into v_site_attnum
  from pg_attribute
  where attrelid = 'public.payments'::regclass
    and attname = 'site_id'
    and not attisdropped;

  select attnum into v_po_attnum
  from pg_attribute
  where attrelid = 'public.payments'::regclass
    and attname = 'purchase_order_id'
    and not attisdropped;

  select attnum into v_site_id_attnum
  from pg_attribute
  where attrelid = 'public.sites'::regclass
    and attname = 'id'
    and not attisdropped;

  select attnum into v_po_id_attnum
  from pg_attribute
  where attrelid = 'public.procurement_purchase_orders'::regclass
    and attname = 'id'
    and not attisdropped;

  if not exists (
    select 1 from pg_attribute
    where attrelid = 'public.payments'::regclass
      and attname = 'site_id'
      and atttypid = 'uuid'::regtype
      and not attnotnull
      and not atthasdef
      and not attisdropped
  ) or not exists (
    select 1 from pg_attribute
    where attrelid = 'public.payments'::regclass
      and attname = 'purchase_order_id'
      and atttypid = 'uuid'::regtype
      and not attnotnull
      and not atthasdef
      and not attisdropped
  ) then
    raise exception 'Payments PO linkage columns must be nullable UUIDs without defaults.';
  end if;

  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.payments'::regclass
      and conname = 'payments_site_id_fkey'
      and not (
        contype = 'f'
        and confrelid = 'public.sites'::regclass
        and conkey = array[v_site_attnum]::smallint[]
        and confkey = array[v_site_id_attnum]::smallint[]
        and confdeltype = 'r'
        and convalidated
      )
  ) then
    raise exception 'Constraint payments_site_id_fkey already exists with an incompatible definition.';
  elsif not exists (
    select 1 from pg_constraint
    where conrelid = 'public.payments'::regclass
      and conname = 'payments_site_id_fkey'
      and contype = 'f'
      and confrelid = 'public.sites'::regclass
      and conkey = array[v_site_attnum]::smallint[]
      and confkey = array[v_site_id_attnum]::smallint[]
      and confdeltype = 'r'
      and convalidated
  ) then
    alter table public.payments
      add constraint payments_site_id_fkey
      foreign key (site_id) references public.sites(id) on delete restrict;
  end if;

  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.payments'::regclass
      and conname = 'payments_purchase_order_id_fkey'
      and not (
        contype = 'f'
        and confrelid = 'public.procurement_purchase_orders'::regclass
        and conkey = array[v_po_attnum]::smallint[]
        and confkey = array[v_po_id_attnum]::smallint[]
        and confdeltype = 'r'
        and convalidated
      )
  ) then
    raise exception 'Constraint payments_purchase_order_id_fkey already exists with an incompatible definition.';
  elsif not exists (
    select 1 from pg_constraint
    where conrelid = 'public.payments'::regclass
      and conname = 'payments_purchase_order_id_fkey'
      and contype = 'f'
      and confrelid = 'public.procurement_purchase_orders'::regclass
      and conkey = array[v_po_attnum]::smallint[]
      and confkey = array[v_po_id_attnum]::smallint[]
      and confdeltype = 'r'
      and convalidated
  ) then
    alter table public.payments
      add constraint payments_purchase_order_id_fkey
      foreign key (purchase_order_id)
      references public.procurement_purchase_orders(id)
      on delete restrict;
  end if;
end $$;

do $$
declare
  v_site_attnum smallint;
  v_po_attnum smallint;
  v_index record;
begin
  select attnum into v_site_attnum
  from pg_attribute
  where attrelid = 'public.payments'::regclass
    and attname = 'site_id'
    and not attisdropped;

  select attnum into v_po_attnum
  from pg_attribute
  where attrelid = 'public.payments'::regclass
    and attname = 'purchase_order_id'
    and not attisdropped;

  select i.indrelid, i.indkey::text as index_keys, i.indnkeyatts,
         i.indnatts, i.indisunique, i.indisvalid, i.indisready,
         i.indpred is null as has_no_predicate, am.amname
    into v_index
  from pg_class index_class
  join pg_namespace index_namespace on index_namespace.oid = index_class.relnamespace
  join pg_index i on i.indexrelid = index_class.oid
  join pg_am am on am.oid = index_class.relam
  where index_namespace.nspname = 'public'
    and index_class.relname = 'payments_site_id_idx';

  if found then
    if v_index.indrelid <> 'public.payments'::regclass
      or v_index.index_keys <> v_site_attnum::text
      or v_index.indnkeyatts <> 1
      or v_index.indnatts <> 1
      or v_index.indisunique
      or not v_index.indisvalid
      or not v_index.indisready
      or not v_index.has_no_predicate
      or v_index.amname <> 'btree' then
      raise exception 'Index payments_site_id_idx already exists with an incompatible definition.';
    end if;
  else
    create index payments_site_id_idx on public.payments(site_id);
  end if;

  select i.indrelid, i.indkey::text as index_keys, i.indnkeyatts,
         i.indnatts, i.indisunique, i.indisvalid, i.indisready,
         i.indpred is null as has_no_predicate, am.amname
    into v_index
  from pg_class index_class
  join pg_namespace index_namespace on index_namespace.oid = index_class.relnamespace
  join pg_index i on i.indexrelid = index_class.oid
  join pg_am am on am.oid = index_class.relam
  where index_namespace.nspname = 'public'
    and index_class.relname = 'payments_purchase_order_id_idx';

  if found then
    if v_index.indrelid <> 'public.payments'::regclass
      or v_index.index_keys <> v_po_attnum::text
      or v_index.indnkeyatts <> 1
      or v_index.indnatts <> 1
      or v_index.indisunique
      or not v_index.indisvalid
      or not v_index.indisready
      or not v_index.has_no_predicate
      or v_index.amname <> 'btree' then
      raise exception 'Index payments_purchase_order_id_idx already exists with an incompatible definition.';
    end if;
  else
    create index payments_purchase_order_id_idx on public.payments(purchase_order_id);
  end if;
end $$;

commit;
