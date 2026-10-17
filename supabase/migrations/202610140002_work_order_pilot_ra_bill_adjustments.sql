-- Prepared only. Apply separately; Pilot RA Bill fields only.
alter table public.work_order_pilot_ra_bills
  add column if not exists withheld numeric not null default 0,
  add column if not exists labour_cess numeric not null default 0;
