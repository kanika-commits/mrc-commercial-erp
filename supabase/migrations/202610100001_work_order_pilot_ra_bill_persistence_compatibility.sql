-- Forward-only Pilot RA Bill compatibility and reviewed-artifact persistence.
-- Safe when 202610090001 was applied previously or is applied with this migration.
alter table public.work_order_pilot_ra_bill_items
  add column if not exists bill_qty numeric not null default 0,
  add column if not exists cumulative_qty numeric not null default 0,
  add column if not exists current_amount numeric not null default 0;

alter table public.work_order_pilot_ra_bills
  add column if not exists reviewed_pdf_sha256 text,
  add column if not exists reviewed_pdf_byte_length integer;

alter table public.work_order_pilot_ra_bills
  drop constraint if exists work_order_pilot_ra_bills_status_check;
alter table public.work_order_pilot_ra_bills
  add constraint work_order_pilot_ra_bills_status_check
  check (status in ('draft', 'submitted', 'approved', 'rejected', 'sent_back'));

create table if not exists public.work_order_pilot_ra_bill_reviewed_artifacts (
  id uuid primary key default gen_random_uuid(),
  ra_bill_id uuid not null unique references public.work_order_pilot_ra_bills(id) on delete cascade,
  pdf_bytes bytea not null,
  sha256 text not null,
  byte_length integer not null,
  created_at timestamptz not null default now()
);
grant all on public.work_order_pilot_ra_bill_reviewed_artifacts to service_role;
