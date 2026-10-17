-- Pilot-only durable Drive filing state. Prepare only; do not apply automatically.
alter table public.work_order_pilot_ra_bills
  add column if not exists drive_filing_status text not null default 'pending'
    check (drive_filing_status in ('pending', 'in_progress', 'filed', 'failed')),
  add column if not exists drive_filing_error text,
  add column if not exists drive_filing_updated_at timestamptz;

create index if not exists work_order_pilot_ra_bills_drive_filing_status_idx
  on public.work_order_pilot_ra_bills(drive_filing_status)
  where status = 'submitted' or status = 'approved';
