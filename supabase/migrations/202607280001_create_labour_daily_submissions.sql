create table if not exists public.labour_daily_submissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  company_id uuid not null references public.companies(id),
  site_id uuid not null references public.sites(id),
  work_date date not null,
  contractor_profile_id uuid not null references public.labour_contractor_profiles(id),
  status text not null default 'draft'
    check (status in ('draft', 'pending_pm_approval', 'sent_back_by_pm', 'pending_ho_approval', 'sent_back_by_ho', 'final_approved', 'cancelled')),
  submission_version integer not null default 0 check (submission_version >= 0),
  submitted_by uuid,
  submitted_by_name text,
  submitted_by_email text,
  submitted_at timestamptz,
  pm_reviewer_id uuid,
  pm_approved_by uuid,
  pm_approved_by_name text,
  pm_approved_by_email text,
  pm_approved_at timestamptz,
  pm_remarks text,
  pm_sent_back_by uuid,
  pm_sent_back_by_name text,
  pm_sent_back_by_email text,
  pm_sent_back_at timestamptz,
  pm_send_back_reason text,
  ho_reviewer_id uuid,
  ho_approved_by uuid,
  ho_approved_by_name text,
  ho_approved_by_email text,
  ho_approved_at timestamptz,
  ho_remarks text,
  ho_sent_back_by uuid,
  ho_sent_back_by_name text,
  ho_sent_back_by_email text,
  ho_sent_back_at timestamptz,
  ho_send_back_reason text,
  final_approved_at timestamptz,
  last_transition text,
  last_transition_at timestamptz,
  snapshot jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_by_name text,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_by_name text,
  updated_by_email text,
  updated_at timestamptz not null default now(),
  constraint labour_daily_submissions_unique_scope
    unique (organization_id, company_id, site_id, work_date, contractor_profile_id)
);

create table if not exists public.labour_daily_submission_events (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.labour_daily_submissions(id) on delete cascade,
  organization_id uuid not null references public.organizations(id),
  company_id uuid not null references public.companies(id),
  site_id uuid not null references public.sites(id),
  contractor_profile_id uuid not null references public.labour_contractor_profiles(id),
  work_date date not null,
  submission_version integer not null,
  action text not null
    check (action in ('site_hr_submit', 'site_hr_resubmit', 'pm_approve', 'pm_send_back', 'ho_final_approve', 'ho_send_back', 'final_override')),
  previous_status text,
  new_status text not null,
  reason text,
  remarks text,
  snapshot jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_by_name text,
  created_by_email text,
  created_at timestamptz not null default now()
);

create table if not exists public.labour_daily_work_engineer_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  company_id uuid not null references public.companies(id),
  site_id uuid not null references public.sites(id),
  work_date date not null,
  contractor_profile_id uuid not null references public.labour_contractor_profiles(id),
  engineer_user_id uuid not null references public.profiles(id),
  status text not null default 'active' check (status in ('active', 'cancelled')),
  assigned_by uuid,
  assigned_by_name text,
  assigned_by_email text,
  assigned_at timestamptz not null default now(),
  updated_by uuid,
  updated_by_name text,
  updated_by_email text,
  updated_at timestamptz not null default now()
);

create index if not exists labour_daily_submissions_queue_idx
  on public.labour_daily_submissions (organization_id, company_id, site_id, work_date, contractor_profile_id, status);

create index if not exists labour_daily_submissions_status_idx
  on public.labour_daily_submissions (status, work_date desc);

create index if not exists labour_daily_submission_events_submission_idx
  on public.labour_daily_submission_events (submission_id, submission_version, created_at desc);

create index if not exists labour_daily_work_engineer_assignments_scope_idx
  on public.labour_daily_work_engineer_assignments (organization_id, company_id, site_id, work_date, contractor_profile_id, status);

create unique index if not exists labour_daily_work_engineer_assignments_active_uidx
  on public.labour_daily_work_engineer_assignments (organization_id, company_id, site_id, work_date, contractor_profile_id)
  where status = 'active';

create index if not exists labour_daily_work_engineer_assignments_engineer_idx
  on public.labour_daily_work_engineer_assignments (engineer_user_id, work_date desc, status);

alter table public.labour_daily_submissions enable row level security;
alter table public.labour_daily_submission_events enable row level security;
alter table public.labour_daily_work_engineer_assignments enable row level security;

grant all on public.labour_daily_submissions to service_role;
grant all on public.labour_daily_submission_events to service_role;
grant all on public.labour_daily_work_engineer_assignments to service_role;

insert into public.erp_modules (module_code, module_name, module_group, route, status, sort_order)
values ('labour_daily_submission', 'Labour Approval', 'hr', '/labour/approvals', 'active', 4.5)
on conflict (module_code) do update
set module_name = excluded.module_name,
    module_group = excluded.module_group,
    route = excluded.route,
    status = excluded.status,
    sort_order = excluded.sort_order;

with approval_permissions(module_code, action_code) as (
  values
    ('labour_daily_submission', 'view'),
    ('labour_daily_submission', 'submit'),
    ('labour_daily_submission', 'pm_approve'),
    ('labour_daily_submission', 'pm_send_back'),
    ('labour_daily_submission', 'ho_approve'),
    ('labour_daily_submission', 'ho_send_back'),
    ('labour_daily_submission', 'final_override'),
    ('labour_daily_submission', 'export'),
    ('labour_work_logs', 'assign_engineer')
),
system_roles as (
  select id
  from public.roles
  where role_code in ('platform_owner', 'super_admin')
)
update public.role_permissions rp
set allowed = true
from system_roles r
cross join approval_permissions p
where rp.role_id = r.id
  and rp.module_code = p.module_code
  and rp.action_code = p.action_code;

with approval_permissions(module_code, action_code) as (
  values
    ('labour_daily_submission', 'view'),
    ('labour_daily_submission', 'submit'),
    ('labour_daily_submission', 'pm_approve'),
    ('labour_daily_submission', 'pm_send_back'),
    ('labour_daily_submission', 'ho_approve'),
    ('labour_daily_submission', 'ho_send_back'),
    ('labour_daily_submission', 'final_override'),
    ('labour_daily_submission', 'export'),
    ('labour_work_logs', 'assign_engineer')
),
system_roles as (
  select id
  from public.roles
  where role_code in ('platform_owner', 'super_admin')
)
insert into public.role_permissions (role_id, module_code, action_code, allowed)
select r.id, p.module_code, p.action_code, true
from system_roles r
cross join approval_permissions p
where not exists (
  select 1
  from public.role_permissions rp
  where rp.role_id = r.id
    and rp.module_code = p.module_code
    and rp.action_code = p.action_code
);
