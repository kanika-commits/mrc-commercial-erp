-- Source-only prerequisite for System Activity reads.
-- Review and apply separately; this file is intentionally not executed here.
-- The activity API filters by time, orders newest-first, and limits each source.
-- These indexes keep Platform Owner reads efficient without changing data, RLS,
-- authorization, or the activity result set.

create index if not exists erp_audit_logs_created_at_idx
  on public.erp_audit_logs (created_at desc);

create index if not exists deleted_records_audit_deleted_at_idx
  on public.deleted_records_audit (deleted_at desc);

create index if not exists work_order_pilot_ra_bill_review_audit_created_at_idx
  on public.work_order_pilot_ra_bill_review_audit (created_at desc);
