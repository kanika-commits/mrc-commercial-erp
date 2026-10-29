-- Daily Wage Work Orders use manually entered people/labour rows rather than Item Master rows.
-- Prepared for manual application only; do not apply this file automatically.
alter table public.work_order_items
  alter column item_master_id drop not null,
  alter column mode_of_measurement_snapshot drop not null;
