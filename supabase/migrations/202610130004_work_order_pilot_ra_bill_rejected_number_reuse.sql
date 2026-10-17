-- Pilot-only: rejected bills remain auditable but do not reserve their RA number.
-- Prepare only; apply through the isolated migration procedure.
alter table public.work_order_pilot_ra_bills
  drop constraint if exists work_order_pilot_ra_bills_organization_id_bill_number_key;

create unique index if not exists work_order_pilot_ra_bill_active_number_key
  on public.work_order_pilot_ra_bills (organization_id, bill_number)
  where deleted_at is null and status <> 'rejected';
