-- Prepared only; do not apply without review.
-- Persist the user-entered Work Order-only item description alongside the master snapshot.

begin;

alter table public.work_order_items
  add column if not exists additional_description_snapshot text;

commit;
