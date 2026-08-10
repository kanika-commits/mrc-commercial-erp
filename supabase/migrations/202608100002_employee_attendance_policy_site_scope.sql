-- Convert Employee Attendance Policy identity from company + site to site-first.
-- Existing policy IDs and child configuration are preserved.

alter table public.employee_attendance_policies
  alter column company_id drop not null;

alter table public.employee_attendance_policy_layers
  alter column company_id drop not null;

alter table public.employee_attendance_post_lock_editors
  alter column company_id drop not null;

alter table public.employee_attendance_policies
  drop constraint if exists employee_attendance_policies_scope_unique;

create unique index if not exists employee_attendance_policies_site_scope_uidx
  on public.employee_attendance_policies (organization_id, site_id)
  where status <> 'deleted';

create index if not exists employee_attendance_policies_site_scope_idx
  on public.employee_attendance_policies (organization_id, site_id, status);
