begin;

alter table public.work_orders
  add column if not exists letterhead_snapshot jsonb,
  add column if not exists standard_terms_snapshot text not null default '',
  add column if not exists total_basic_amount numeric(14,2) not null default 0 check (total_basic_amount >= 0),
  add column if not exists total_gst_amount numeric(14,2) not null default 0 check (total_gst_amount >= 0),
  add column if not exists total_amount numeric(14,2) not null default 0 check (total_amount >= 0),
  add column if not exists creation_request_id uuid;

create unique index if not exists work_orders_creation_request_uidx
  on public.work_orders (organization_id, creation_request_id)
  where creation_request_id is not null;

alter table public.work_order_items
  add column if not exists quantity numeric(14,3) not null default 1 check (quantity > 0),
  add column if not exists unit_rate numeric(14,4) not null default 0 check (unit_rate >= 0),
  add column if not exists gst_percent numeric(7,4) not null default 0 check (gst_percent >= 0),
  add column if not exists basic_amount numeric(14,2) not null default 0 check (basic_amount >= 0),
  add column if not exists gst_amount numeric(14,2) not null default 0 check (gst_amount >= 0),
  add column if not exists line_total numeric(14,2) not null default 0 check (line_total >= 0);

create index if not exists work_order_items_master_order_idx
  on public.work_order_items (organization_id, item_master_id, work_order_id);

commit;
