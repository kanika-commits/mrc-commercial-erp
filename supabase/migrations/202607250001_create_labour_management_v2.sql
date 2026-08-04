-- Labour Management V2: Manpower Work Orders, effective rates, policies, crews,
-- work logs, photo evidence and overtime controls.
-- Pending migration only. Safe to run after the existing Labour Foundation,
-- Labour Operations and Labour Attendance Import migrations.

begin;

create extension if not exists pgcrypto;

do $$
begin
  if to_regclass('public.erp_modules') is not null then
    insert into public.erp_modules (module_group, module_code, module_name, route, sort_order, status)
    values
      ('labour_management', 'labour_manpower_work_orders', 'Manpower Work Orders', '/labour/manpower-work-orders', 3.5, 'active'),
      ('labour_management', 'labour_attendance_policy', 'Attendance Policy', '/labour/settings', 8, 'active'),
      ('labour_management', 'labour_work_groups', 'Work Groups', '/labour/work-logs', 8.5, 'active'),
      ('labour_management', 'labour_work_logs', 'Daily Work Logs', '/labour/work-logs', 9, 'active'),
      ('labour_management', 'labour_overtime', 'Overtime Review', '/labour/work-logs', 9.5, 'active'),
      ('labour_management', 'labour_photo_evidence', 'Labour Photo Evidence', '/labour/work-logs', 9.8, 'active'),
      ('labour_management', 'labour_rate_overrides', 'Labour Rate Overrides', '/labour/manpower-work-orders', 10.2, 'active')
    on conflict (module_code) do update
      set module_name = excluded.module_name,
          route = excluded.route,
          sort_order = excluded.sort_order,
          status = excluded.status;
  end if;
end $$;

alter table public.labour_workers add column if not exists aadhaar_status text not null default 'pending'
  check (aadhaar_status in ('pending', 'verified', 'not_available'));
alter table public.labour_workers add column if not exists photo_status text not null default 'pending'
  check (photo_status in ('pending', 'available'));

alter table public.labour_deployments add column if not exists manpower_work_order_id uuid;
alter table public.labour_deployments add column if not exists commercial_model text not null default 'contract_basis'
  check (commercial_model in ('contract_basis', 'daily_wage'));
alter table public.labour_deployments add column if not exists transfer_reason text;
alter table public.labour_attendance add column if not exists start_time time;
alter table public.labour_attendance add column if not exists end_time time;
alter table public.labour_attendance add column if not exists proposed_overtime_minutes integer not null default 0 check (proposed_overtime_minutes >= 0);
alter table public.labour_attendance add column if not exists approved_overtime_minutes integer check (approved_overtime_minutes is null or approved_overtime_minutes >= 0);
alter table public.labour_attendance add column if not exists commercial_model text not null default 'contract_basis'
  check (commercial_model in ('contract_basis', 'daily_wage'));
alter table public.labour_attendance add column if not exists manpower_work_order_id uuid;

create table if not exists public.manpower_work_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete restrict,
  site_id uuid not null references public.sites(id) on delete restrict,
  contractor_profile_id uuid not null references public.labour_contractor_profiles(id) on delete restrict,
  manpower_wo_number text not null,
  title text not null,
  scope text,
  commercial_work_order_id uuid references public.work_orders(id) on delete set null,
  engagement_type text not null default 'daily_wage' check (engagement_type in ('daily_wage', 'direct_labour')),
  effective_from date not null,
  effective_to date,
  shift_start_time time,
  shift_end_time time,
  standard_break_minutes integer check (standard_break_minutes is null or standard_break_minutes >= 0),
  overtime_basis text not null default 'hourly' check (overtime_basis in ('hourly', 'fixed_per_hour', 'category_rate')),
  contractor_profit_type text not null default 'none' check (contractor_profit_type in ('none', 'percentage', 'fixed_per_labour_day')),
  contractor_profit_value numeric(14,2) not null default 0 check (contractor_profit_value >= 0),
  status text not null default 'draft' check (status in ('draft', 'submitted', 'approved', 'suspended', 'completed', 'cancelled')),
  submitted_by uuid,
  submitted_by_name text,
  submitted_by_email text,
  submitted_at timestamptz,
  approved_by uuid,
  approved_by_name text,
  approved_by_email text,
  approved_at timestamptz,
  approval_reason text,
  rejected_by uuid,
  rejected_by_name text,
  rejected_by_email text,
  rejected_at timestamptz,
  rejection_reason text,
  notes text,
  created_by uuid,
  created_by_name text,
  created_by_email text,
  updated_by uuid,
  updated_by_name text,
  updated_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from),
  constraint manpower_work_orders_org_number_unique unique (organization_id, manpower_wo_number)
);

alter table public.labour_deployments
  add constraint labour_deployments_manpower_wo_fk
  foreign key (manpower_work_order_id) references public.manpower_work_orders(id) on delete set null;

alter table public.labour_attendance
  add constraint labour_attendance_manpower_wo_fk
  foreign key (manpower_work_order_id) references public.manpower_work_orders(id) on delete set null;

create table if not exists public.manpower_work_order_rates (
  id uuid primary key default gen_random_uuid(),
  manpower_work_order_id uuid not null references public.manpower_work_orders(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete restrict,
  site_id uuid not null references public.sites(id) on delete restrict,
  contractor_profile_id uuid not null references public.labour_contractor_profiles(id) on delete restrict,
  labour_trade_id uuid not null references public.labour_trades(id) on delete restrict,
  daily_rate numeric(14,2) not null check (daily_rate >= 0),
  overtime_rate numeric(14,2) check (overtime_rate is null or overtime_rate >= 0),
  contractor_profit_override numeric(14,2) check (contractor_profit_override is null or contractor_profit_override >= 0),
  effective_from date not null,
  effective_to date,
  status text not null default 'active' check (status in ('active', 'ended', 'cancelled')),
  revision_number integer not null default 1,
  reason text,
  created_by uuid,
  created_by_name text,
  created_by_email text,
  updated_by uuid,
  updated_by_name text,
  updated_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);

create unique index if not exists manpower_work_order_rates_open_uidx
  on public.manpower_work_order_rates (manpower_work_order_id, labour_trade_id)
  where effective_to is null and status = 'active';

create table if not exists public.labour_worker_rate_overrides (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  labour_worker_id uuid not null references public.labour_workers(id) on delete cascade,
  deployment_id uuid references public.labour_deployments(id) on delete set null,
  manpower_work_order_id uuid references public.manpower_work_orders(id) on delete cascade,
  labour_trade_id uuid references public.labour_trades(id),
  daily_rate numeric(14,2) not null check (daily_rate >= 0),
  overtime_rate numeric(14,2) check (overtime_rate is null or overtime_rate >= 0),
  effective_from date not null,
  effective_to date,
  status text not null default 'active' check (status in ('active', 'ended', 'cancelled')),
  reason text not null,
  created_by uuid,
  created_by_name text,
  created_by_email text,
  updated_by uuid,
  updated_by_name text,
  updated_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);

create unique index if not exists labour_worker_rate_overrides_open_uidx
  on public.labour_worker_rate_overrides (labour_worker_id, manpower_work_order_id, labour_trade_id)
  where effective_to is null and status = 'active';

create table if not exists public.labour_site_attendance_policies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  company_id uuid not null references public.companies(id),
  site_id uuid not null references public.sites(id),
  timezone text not null default 'Asia/Kolkata',
  shift_start_time time,
  shift_end_time time,
  attendance_entry_cutoff time,
  normal_work_photo_cutoff time,
  overtime_submission_cutoff time,
  overtime_approval_cutoff time,
  auto_lock_time time,
  backdated_window_days integer not null default 0 check (backdated_window_days >= 0),
  max_daily_ot_minutes integer check (max_daily_ot_minutes is null or max_daily_ot_minutes >= 0),
  max_monthly_ot_minutes integer check (max_monthly_ot_minutes is null or max_monthly_ot_minutes >= 0),
  ot_rounding_minutes integer check (ot_rounding_minutes is null or ot_rounding_minutes >= 0),
  minimum_ot_minutes integer check (minimum_ot_minutes is null or minimum_ot_minutes >= 0),
  require_normal_work_photo boolean not null default false,
  require_ot_start_photo boolean not null default false,
  require_ot_end_photo boolean not null default false,
  allow_self_approval boolean not null default false,
  status text not null default 'active' check (status in ('active', 'inactive', 'ended')),
  effective_from date not null default current_date,
  effective_to date,
  created_by uuid,
  created_by_name text,
  created_by_email text,
  updated_by uuid,
  updated_by_name text,
  updated_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);

create unique index if not exists labour_site_attendance_policies_open_uidx
  on public.labour_site_attendance_policies (organization_id, company_id, site_id)
  where effective_to is null and status = 'active';

create table if not exists public.labour_attendance_unlock_windows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  company_id uuid not null references public.companies(id),
  site_id uuid not null references public.sites(id),
  contractor_profile_id uuid references public.labour_contractor_profiles(id),
  attendance_date date not null,
  opened_by uuid,
  opened_by_name text,
  opened_by_email text,
  reason text not null,
  opens_at timestamptz not null default now(),
  expires_at timestamptz not null,
  closed_at timestamptz,
  status text not null default 'open' check (status in ('open', 'closed', 'expired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.labour_work_groups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  company_id uuid not null references public.companies(id),
  site_id uuid not null references public.sites(id),
  work_date date not null,
  contractor_profile_id uuid references public.labour_contractor_profiles(id),
  commercial_work_order_id uuid references public.work_orders(id),
  manpower_work_order_id uuid references public.manpower_work_orders(id),
  commercial_model text not null check (commercial_model in ('contract_basis', 'daily_wage')),
  crew_code text,
  crew_name text not null,
  supervisor_user_id uuid,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'verified', 'approved', 'locked')),
  created_by uuid,
  created_by_name text,
  created_by_email text,
  updated_by uuid,
  updated_by_name text,
  updated_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.labour_work_group_members (
  id uuid primary key default gen_random_uuid(),
  work_group_id uuid not null references public.labour_work_groups(id) on delete cascade,
  labour_worker_id uuid not null references public.labour_workers(id),
  attendance_id uuid references public.labour_attendance(id),
  deployment_id uuid references public.labour_deployments(id),
  joined_from time,
  joined_to time,
  role_snapshot text,
  category_snapshot text,
  created_by uuid,
  created_by_name text,
  created_by_email text,
  created_at timestamptz not null default now(),
  unique (work_group_id, labour_worker_id)
);

create table if not exists public.labour_daily_work_logs (
  id uuid primary key default gen_random_uuid(),
  work_group_id uuid references public.labour_work_groups(id) on delete set null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  company_id uuid not null references public.companies(id),
  site_id uuid not null references public.sites(id),
  work_date date not null,
  contractor_profile_id uuid references public.labour_contractor_profiles(id),
  commercial_work_order_id uuid references public.work_orders(id),
  manpower_work_order_id uuid references public.manpower_work_orders(id),
  commercial_model text not null check (commercial_model in ('contract_basis', 'daily_wage')),
  work_type text not null check (work_type in ('productive', 'non_productive')),
  activity text not null,
  location_zone text,
  start_time time,
  end_time time,
  unit text,
  quantity numeric(14,3),
  remarks text,
  non_productive_reason text,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'verified', 'approved', 'rejected', 'locked')),
  submitted_by uuid,
  submitted_by_name text,
  submitted_by_email text,
  submitted_at timestamptz,
  verified_by uuid,
  verified_by_name text,
  verified_by_email text,
  verified_at timestamptz,
  approved_by uuid,
  approved_by_name text,
  approved_by_email text,
  approved_at timestamptz,
  transition_reason text,
  created_by uuid,
  created_by_name text,
  created_by_email text,
  updated_by uuid,
  updated_by_name text,
  updated_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.labour_photo_evidence (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  company_id uuid references public.companies(id),
  site_id uuid references public.sites(id),
  work_date date,
  evidence_date date,
  reference_type text not null,
  reference_id uuid not null,
  work_group_id uuid references public.labour_work_groups(id) on delete set null,
  work_log_id uuid references public.labour_daily_work_logs(id) on delete set null,
  overtime_request_id uuid,
  photo_type text not null,
  server_received_at timestamptz not null default now(),
  storage_provider text not null default 'supabase',
  storage_bucket text not null,
  storage_key text not null,
  original_file_name text not null,
  mime_type text,
  size_bytes bigint,
  checksum text,
  version integer not null default 1,
  is_active boolean not null default true,
  replaced_by_photo_id uuid references public.labour_photo_evidence(id) on delete set null,
  remarks text,
  replacement_reason text,
  uploaded_by uuid,
  uploaded_by_name text,
  uploaded_by_email text,
  created_at timestamptz not null default now()
);

create table if not exists public.labour_overtime_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  company_id uuid not null references public.companies(id),
  site_id uuid not null references public.sites(id),
  attendance_id uuid not null references public.labour_attendance(id) on delete cascade,
  labour_worker_id uuid not null references public.labour_workers(id),
  work_group_id uuid references public.labour_work_groups(id),
  work_log_id uuid references public.labour_daily_work_logs(id),
  proposed_start time,
  proposed_end time,
  proposed_minutes integer not null default 0 check (proposed_minutes >= 0),
  approved_minutes integer check (approved_minutes is null or approved_minutes >= 0),
  reason text not null,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'verified', 'approved', 'rejected', 'locked')),
  verified_by uuid,
  verified_by_name text,
  verified_by_email text,
  verified_at timestamptz,
  approved_by uuid,
  approved_by_name text,
  approved_by_email text,
  approved_at timestamptz,
  transition_reason text,
  created_by uuid,
  created_by_name text,
  created_by_email text,
  updated_by uuid,
  updated_by_name text,
  updated_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists manpower_work_orders_scope_status_idx on public.manpower_work_orders (organization_id, company_id, site_id, status);
create index if not exists manpower_work_order_rates_effective_idx on public.manpower_work_order_rates (manpower_work_order_id, labour_trade_id, effective_from, effective_to, status);
create index if not exists labour_deployments_mwo_idx on public.labour_deployments (manpower_work_order_id, commercial_model, effective_from, effective_to, status);
create index if not exists labour_work_groups_scope_date_idx on public.labour_work_groups (organization_id, company_id, site_id, work_date, status);
create index if not exists labour_work_logs_scope_date_idx on public.labour_daily_work_logs (organization_id, company_id, site_id, work_date, status);
create index if not exists labour_overtime_scope_status_idx on public.labour_overtime_requests (organization_id, company_id, site_id, status);
create index if not exists labour_photo_evidence_reference_idx on public.labour_photo_evidence (reference_type, reference_id, is_active);

create or replace function public.transfer_labour_deployment(
  p_worker_id uuid,
  p_organization_id uuid,
  p_contractor_profile_id uuid,
  p_company_id uuid,
  p_site_id uuid,
  p_work_order_id uuid,
  p_manpower_work_order_id uuid,
  p_commercial_model text,
  p_trade text,
  p_skill_level text,
  p_wage_type text,
  p_wage_rate numeric,
  p_effective_from date,
  p_effective_to date,
  p_deployment_reason text,
  p_actor_id uuid,
  p_actor_name text,
  p_actor_email text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_worker public.labour_workers%rowtype;
  v_open public.labour_deployments%rowtype;
  v_close_date date;
  v_deployment_id uuid;
begin
  if p_commercial_model not in ('contract_basis', 'daily_wage') then
    raise exception 'Invalid commercial model.';
  end if;
  if p_commercial_model = 'contract_basis' and p_work_order_id is null then
    raise exception 'Contract-basis deployment requires a Commercial Work Order.';
  end if;
  if p_commercial_model = 'daily_wage' and p_manpower_work_order_id is null then
    raise exception 'Daily-wage deployment requires a Manpower Work Order.';
  end if;

  select * into v_worker
  from public.labour_workers
  where id = p_worker_id and organization_id = p_organization_id and status <> 'deleted'
  for update;

  if not found then
    raise exception 'Labourer not found.';
  end if;

  if p_effective_from is null then
    raise exception 'Effective date is required.';
  end if;

  select * into v_open
  from public.labour_deployments
  where labour_worker_id = p_worker_id
    and status = 'active'
    and effective_to is null
  for update;

  if exists (
    select 1 from public.labour_deployments d
    where d.labour_worker_id = p_worker_id
      and d.id is distinct from coalesce(v_open.id, '00000000-0000-0000-0000-000000000000'::uuid)
      and d.effective_from <= coalesce(p_effective_to, '9999-12-31'::date)
      and coalesce(d.effective_to, '9999-12-31'::date) >= p_effective_from
  ) then
    raise exception 'Deployment dates overlap an existing deployment.';
  end if;

  if v_open.id is not null then
    v_close_date := p_effective_from - 1;
    if v_close_date < v_open.effective_from then
      raise exception 'Transfer date must be after the current deployment start date.';
    end if;

    update public.labour_deployments
    set effective_to = v_close_date,
        status = 'ended',
        updated_at = now(),
        updated_by = p_actor_id,
        updated_by_name = p_actor_name,
        updated_by_email = p_actor_email
    where id = v_open.id;
  end if;

  insert into public.labour_deployments (
    organization_id, labour_worker_id, contractor_profile_id, company_id, site_id,
    work_order_id, manpower_work_order_id, commercial_model, trade, skill_level,
    wage_type, wage_rate, effective_from, effective_to, status, deployment_reason,
    created_by, created_by_name, created_by_email, updated_by, updated_by_name,
    updated_by_email, updated_at
  )
  values (
    p_organization_id, p_worker_id, p_contractor_profile_id, p_company_id, p_site_id,
    p_work_order_id, p_manpower_work_order_id, p_commercial_model, p_trade, p_skill_level,
    p_wage_type, p_wage_rate, p_effective_from, p_effective_to,
    case when p_effective_to is null then 'active' else 'ended' end,
    p_deployment_reason, p_actor_id, p_actor_name, p_actor_email,
    p_actor_id, p_actor_name, p_actor_email, now()
  )
  returning id into v_deployment_id;

  update public.labour_workers
  set current_contractor_profile_id = p_contractor_profile_id,
      current_company_id = p_company_id,
      current_site_id = p_site_id,
      current_work_order_id = p_work_order_id,
      trade = coalesce(p_trade, trade),
      skill_level = coalesce(p_skill_level, skill_level),
      updated_at = now(),
      updated_by = p_actor_id,
      updated_by_name = p_actor_name,
      updated_by_email = p_actor_email
  where id = p_worker_id;

  return v_deployment_id;
end;
$$;

alter table public.manpower_work_orders enable row level security;
alter table public.manpower_work_order_rates enable row level security;
alter table public.labour_worker_rate_overrides enable row level security;
alter table public.labour_site_attendance_policies enable row level security;
alter table public.labour_attendance_unlock_windows enable row level security;
alter table public.labour_work_groups enable row level security;
alter table public.labour_work_group_members enable row level security;
alter table public.labour_daily_work_logs enable row level security;
alter table public.labour_photo_evidence enable row level security;
alter table public.labour_overtime_requests enable row level security;

grant all on public.manpower_work_orders to service_role;
grant all on public.manpower_work_order_rates to service_role;
grant all on public.labour_worker_rate_overrides to service_role;
grant all on public.labour_site_attendance_policies to service_role;
grant all on public.labour_attendance_unlock_windows to service_role;
grant all on public.labour_work_groups to service_role;
grant all on public.labour_work_group_members to service_role;
grant all on public.labour_daily_work_logs to service_role;
grant all on public.labour_photo_evidence to service_role;
grant all on public.labour_overtime_requests to service_role;

do $$
begin
  if to_regclass('public.roles') is not null and to_regclass('public.role_permissions') is not null then
    insert into public.role_permissions (role_id, module_code, action_code, allowed)
    select roles.id, permissions.module_code, permissions.action_code, true
    from public.roles
    cross join (
      values
        ('labour_manpower_work_orders', 'view'), ('labour_manpower_work_orders', 'add'), ('labour_manpower_work_orders', 'edit'), ('labour_manpower_work_orders', 'delete'), ('labour_manpower_work_orders', 'approve'), ('labour_manpower_work_orders', 'reject'), ('labour_manpower_work_orders', 'upload'), ('labour_manpower_work_orders', 'export'),
        ('labour_attendance_policy', 'view'), ('labour_attendance_policy', 'edit'),
        ('labour_attendance_unlock', 'view'), ('labour_attendance_unlock', 'approve'),
        ('labour_work_groups', 'view'), ('labour_work_groups', 'add'), ('labour_work_groups', 'edit'), ('labour_work_groups', 'delete'), ('labour_work_groups', 'submit'), ('labour_work_groups', 'approve'), ('labour_work_groups', 'export'),
        ('labour_work_logs', 'view'), ('labour_work_logs', 'add'), ('labour_work_logs', 'edit'), ('labour_work_logs', 'delete'), ('labour_work_logs', 'submit'), ('labour_work_logs', 'approve'), ('labour_work_logs', 'reject'), ('labour_work_logs', 'upload'), ('labour_work_logs', 'export'),
        ('labour_overtime', 'view'), ('labour_overtime', 'add'), ('labour_overtime', 'edit'), ('labour_overtime', 'approve'), ('labour_overtime', 'reject'), ('labour_overtime', 'export'),
        ('labour_photo_evidence', 'view'), ('labour_photo_evidence', 'upload'), ('labour_photo_evidence', 'edit'), ('labour_photo_evidence', 'delete'),
        ('labour_rate_overrides', 'view'), ('labour_rate_overrides', 'add'), ('labour_rate_overrides', 'edit'), ('labour_rate_overrides', 'delete'), ('labour_rate_overrides', 'approve'), ('labour_rate_overrides', 'export')
    ) as permissions(module_code, action_code)
    where roles.role_code = 'super_admin'
      and not exists (
        select 1 from public.role_permissions existing
        where existing.role_id = roles.id
          and existing.module_code = permissions.module_code
          and existing.action_code = permissions.action_code
      );
  end if;
end $$;

commit;
