alter table public.work_order_changes
  add column if not exists gst_percent numeric,
  add column if not exists gst_amount numeric,
  add column if not exists updated_wo_basic_value numeric,
  add column if not exists updated_total_wo_value numeric,
  add column if not exists description text;

create index if not exists work_order_changes_change_type_idx
  on public.work_order_changes (change_type);
