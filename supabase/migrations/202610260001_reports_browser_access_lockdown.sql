-- Reports are served through owner-authorized server APIs. Apply only to the
-- existing MRC ERP database; this migration does not seed or alter business rows.
revoke all on table public.erp_audit_logs from anon, authenticated;
revoke all on table public.vendor_audit_logs from anon, authenticated;

grant select on table public.erp_audit_logs to service_role;
grant select, insert on table public.vendor_audit_logs to service_role;

alter table public.erp_audit_logs enable row level security;
alter table public.vendor_audit_logs enable row level security;
