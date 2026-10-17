-- Pilot-only: each Work Order has its own active RA Bill number sequence.
-- Rejected and fully database-deleted bills do not reserve a number.
-- Prepare only; apply through the isolated migration procedure.
drop index if exists public.work_order_pilot_ra_bill_active_number_key;

create unique index if not exists work_order_pilot_ra_bill_active_work_order_number_key
  on public.work_order_pilot_ra_bills (organization_id, work_order_id, bill_number)
  where deleted_at is null and status <> 'rejected';
