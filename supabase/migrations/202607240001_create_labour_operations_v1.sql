-- Labour Operations V1: trades, attendance, muster, wage rates, wages and advances.
-- Safe to run in Supabase SQL Editor; idempotent and non-destructive.

begin;

create extension if not exists pgcrypto;

create table if not exists public.labour_trades (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  trade_name text not null,
  trade_code text,
  description text,
  status text not null default 'active' check (status in ('active', 'inactive', 'deleted')),
  created_by uuid,
  created_by_name text,
  created_by_email text,
  updated_by uuid,
  updated_by_name text,
  updated_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists labour_trades_org_name_uidx
  on public.labour_trades (organization_id, upper(regexp_replace(trim(trade_name), '\s+', ' ', 'g')))
  where status <> 'deleted';

alter table public.labour_workers add column if not exists labour_trade_id uuid references public.labour_trades(id);
alter table public.labour_deployments add column if not exists labour_trade_id uuid references public.labour_trades(id);

create table if not exists public.labour_attendance_periods (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  company_id uuid not null references public.companies(id),
  site_id uuid not null references public.sites(id),
  contractor_profile_id uuid references public.labour_contractor_profiles(id),
  period_month date not null,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'finalized', 'reopened', 'cancelled')),
  summary jsonb not null default '{}'::jsonb,
  submitted_by uuid,
  submitted_by_name text,
  submitted_by_email text,
  submitted_at timestamptz,
  finalized_by uuid,
  finalized_by_name text,
  finalized_by_email text,
  finalized_at timestamptz,
  reopened_by uuid,
  reopened_by_name text,
  reopened_by_email text,
  reopened_at timestamptz,
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

create unique index if not exists labour_attendance_periods_scope_uidx
  on public.labour_attendance_periods (organization_id, company_id, site_id, coalesce(contractor_profile_id, '00000000-0000-0000-0000-000000000000'::uuid), period_month);

create table if not exists public.labour_attendance_day_locks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  company_id uuid not null references public.companies(id),
  site_id uuid not null references public.sites(id),
  contractor_profile_id uuid references public.labour_contractor_profiles(id),
  attendance_date date not null,
  is_locked boolean not null default false,
  locked_by uuid,
  locked_by_name text,
  locked_by_email text,
  locked_at timestamptz,
  unlocked_by uuid,
  unlocked_by_name text,
  unlocked_by_email text,
  unlocked_at timestamptz,
  lock_reason text,
  unlock_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists labour_attendance_day_locks_scope_uidx
  on public.labour_attendance_day_locks (organization_id, company_id, site_id, coalesce(contractor_profile_id, '00000000-0000-0000-0000-000000000000'::uuid), attendance_date);

create table if not exists public.labour_attendance (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  company_id uuid not null references public.companies(id),
  site_id uuid not null references public.sites(id),
  contractor_profile_id uuid references public.labour_contractor_profiles(id),
  labour_worker_id uuid not null references public.labour_workers(id) on delete cascade,
  deployment_id uuid not null references public.labour_deployments(id),
  period_id uuid references public.labour_attendance_periods(id),
  attendance_date date not null,
  status text not null check (status in ('present', 'absent', 'half_day', 'weekly_off', 'holiday', 'leave', 'not_deployed')),
  overtime_minutes integer not null default 0 check (overtime_minutes >= 0),
  remarks text,
  source text not null default 'manual' check (source in ('manual', 'system', 'import')),
  backdated_reason text,
  created_by uuid,
  created_by_name text,
  created_by_email text,
  updated_by uuid,
  updated_by_name text,
  updated_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (labour_worker_id, attendance_date)
);

create table if not exists public.labour_wage_rates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  labour_worker_id uuid not null references public.labour_workers(id) on delete cascade,
  deployment_id uuid references public.labour_deployments(id),
  contractor_profile_id uuid references public.labour_contractor_profiles(id),
  company_id uuid not null references public.companies(id),
  site_id uuid not null references public.sites(id),
  work_order_id uuid references public.work_orders(id),
  trade_id uuid references public.labour_trades(id),
  skill_level text,
  wage_type text not null check (wage_type in ('daily', 'monthly', 'hourly', 'piece_rate')),
  base_rate numeric(14,2) not null check (base_rate >= 0),
  overtime_rate_type text not null default 'hourly' check (overtime_rate_type in ('hourly', 'multiplier', 'fixed')),
  overtime_rate numeric(14,2) check (overtime_rate is null or overtime_rate >= 0),
  weekly_off_paid boolean not null default false,
  holiday_paid boolean not null default false,
  effective_from date not null,
  effective_to date,
  status text not null default 'active' check (status in ('active', 'ended', 'cancelled')),
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

create index if not exists labour_wage_rates_worker_dates_idx on public.labour_wage_rates (labour_worker_id, effective_from, effective_to, status);

create table if not exists public.labour_wage_periods (
  id uuid primary key default gen_random_uuid(),
  attendance_period_id uuid not null unique references public.labour_attendance_periods(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  company_id uuid not null references public.companies(id),
  site_id uuid not null references public.sites(id),
  contractor_profile_id uuid references public.labour_contractor_profiles(id),
  period_month date not null,
  status text not null default 'draft' check (status in ('draft', 'calculated', 'submitted', 'finalized', 'reopened', 'cancelled')),
  summary jsonb not null default '{}'::jsonb,
  transition_reason text,
  submitted_by uuid,
  submitted_by_name text,
  submitted_by_email text,
  submitted_at timestamptz,
  finalized_by uuid,
  finalized_by_name text,
  finalized_by_email text,
  finalized_at timestamptz,
  reopened_by uuid,
  reopened_by_name text,
  reopened_by_email text,
  reopened_at timestamptz,
  created_by uuid,
  created_by_name text,
  created_by_email text,
  updated_by uuid,
  updated_by_name text,
  updated_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.labour_wage_lines (
  id uuid primary key default gen_random_uuid(),
  wage_period_id uuid not null references public.labour_wage_periods(id) on delete cascade,
  labour_worker_id uuid not null references public.labour_workers(id),
  deployment_id uuid references public.labour_deployments(id),
  wage_rate_id uuid references public.labour_wage_rates(id),
  wage_type text,
  base_rate numeric(14,2) not null default 0,
  present_days numeric(8,2) not null default 0,
  half_days numeric(8,2) not null default 0,
  weekly_off_days numeric(8,2) not null default 0,
  holiday_days numeric(8,2) not null default 0,
  leave_days numeric(8,2) not null default 0,
  overtime_minutes integer not null default 0,
  overtime_hours numeric(8,2) not null default 0,
  payable_days numeric(8,2) not null default 0,
  basic_wages numeric(14,2) not null default 0,
  overtime_amount numeric(14,2) not null default 0,
  gross_wages numeric(14,2) not null default 0,
  advance_recovery numeric(14,2) not null default 0,
  other_deductions numeric(14,2) not null default 0,
  net_wages numeric(14,2) not null default 0,
  calculation_details jsonb not null default '{}'::jsonb,
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid', 'partially_paid', 'paid')),
  paid_amount numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (wage_period_id, labour_worker_id)
);

create table if not exists public.labour_advances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  labour_worker_id uuid not null references public.labour_workers(id),
  contractor_profile_id uuid references public.labour_contractor_profiles(id),
  company_id uuid not null references public.companies(id),
  site_id uuid not null references public.sites(id),
  advance_date date not null,
  amount numeric(14,2) not null check (amount > 0),
  purpose text,
  recovery_mode text not null default 'manual' check (recovery_mode in ('one_time', 'installment', 'manual')),
  installment_amount numeric(14,2) check (installment_amount is null or installment_amount >= 0),
  status text not null default 'active' check (status in ('active', 'recovered', 'cancelled')),
  recovered_amount numeric(14,2) not null default 0 check (recovered_amount >= 0),
  balance_amount numeric(14,2) not null default 0 check (balance_amount >= 0),
  payment_reference text,
  remarks text,
  approved_by uuid,
  approved_by_name text,
  approved_by_email text,
  approved_at timestamptz,
  created_by uuid,
  created_by_name text,
  created_by_email text,
  updated_by uuid,
  updated_by_name text,
  updated_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (recovered_amount <= amount),
  check (balance_amount <= amount)
);

create table if not exists public.labour_advance_recoveries (
  id uuid primary key default gen_random_uuid(),
  advance_id uuid not null references public.labour_advances(id) on delete cascade,
  wage_period_id uuid not null references public.labour_wage_periods(id) on delete cascade,
  wage_line_id uuid references public.labour_wage_lines(id) on delete set null,
  recovery_date date not null default current_date,
  amount numeric(14,2) not null check (amount > 0),
  remarks text,
  created_by uuid,
  created_by_name text,
  created_by_email text,
  created_at timestamptz not null default now()
);

create index if not exists labour_attendance_scope_date_idx on public.labour_attendance (organization_id, company_id, site_id, contractor_profile_id, attendance_date);
create index if not exists labour_attendance_worker_date_idx on public.labour_attendance (labour_worker_id, attendance_date);
create index if not exists labour_deployments_worker_dates_idx on public.labour_deployments (labour_worker_id, effective_from, effective_to, status);
create index if not exists labour_wage_periods_scope_month_idx on public.labour_wage_periods (organization_id, company_id, site_id, contractor_profile_id, period_month);
create index if not exists labour_wage_lines_period_idx on public.labour_wage_lines (wage_period_id);
create index if not exists labour_advances_worker_status_idx on public.labour_advances (labour_worker_id, status);
create index if not exists labour_advance_recoveries_period_idx on public.labour_advance_recoveries (wage_period_id);

create or replace function public.replace_labour_wage_lines(
  p_wage_period_id uuid,
  p_lines jsonb,
  p_summary jsonb,
  p_actor_id uuid,
  p_actor_name text,
  p_actor_email text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period public.labour_wage_periods%rowtype;
begin
  select * into v_period
  from public.labour_wage_periods
  where id = p_wage_period_id
  for update;

  if not found then
    raise exception 'Wage period not found.';
  end if;

  if v_period.status = 'finalized' then
    raise exception 'Finalized wage period cannot be recalculated.';
  end if;

  delete from public.labour_wage_lines
  where wage_period_id = p_wage_period_id;

  insert into public.labour_wage_lines (
    wage_period_id, labour_worker_id, deployment_id, wage_rate_id, wage_type, base_rate,
    present_days, half_days, weekly_off_days, holiday_days, leave_days,
    overtime_minutes, overtime_hours, payable_days, basic_wages, overtime_amount,
    gross_wages, advance_recovery, other_deductions, net_wages, payment_status,
    paid_amount, calculation_details
  )
  select
    p_wage_period_id,
    line.labour_worker_id,
    line.deployment_id,
    line.wage_rate_id,
    line.wage_type,
    coalesce(line.base_rate, 0),
    coalesce(line.present_days, 0),
    coalesce(line.half_days, 0),
    coalesce(line.weekly_off_days, 0),
    coalesce(line.holiday_days, 0),
    coalesce(line.leave_days, 0),
    coalesce(line.overtime_minutes, 0),
    coalesce(line.overtime_hours, 0),
    coalesce(line.payable_days, 0),
    coalesce(line.basic_wages, 0),
    coalesce(line.overtime_amount, 0),
    coalesce(line.gross_wages, 0),
    coalesce(line.advance_recovery, 0),
    coalesce(line.other_deductions, 0),
    coalesce(line.net_wages, 0),
    coalesce(line.payment_status, 'unpaid'),
    coalesce(line.paid_amount, 0),
    coalesce(line.calculation_details, '{}'::jsonb)
  from jsonb_to_recordset(coalesce(p_lines, '[]'::jsonb)) as line(
    labour_worker_id uuid,
    deployment_id uuid,
    wage_rate_id uuid,
    wage_type text,
    base_rate numeric,
    present_days numeric,
    half_days numeric,
    weekly_off_days numeric,
    holiday_days numeric,
    leave_days numeric,
    overtime_minutes integer,
    overtime_hours numeric,
    payable_days numeric,
    basic_wages numeric,
    overtime_amount numeric,
    gross_wages numeric,
    advance_recovery numeric,
    other_deductions numeric,
    net_wages numeric,
    payment_status text,
    paid_amount numeric,
    calculation_details jsonb
  );

  update public.labour_wage_periods
  set status = 'calculated',
      summary = coalesce(p_summary, '{}'::jsonb),
      updated_at = now(),
      updated_by = p_actor_id,
      updated_by_name = p_actor_name,
      updated_by_email = p_actor_email
  where id = p_wage_period_id;
end;
$$;

alter table public.labour_trades enable row level security;
alter table public.labour_attendance_periods enable row level security;
alter table public.labour_attendance_day_locks enable row level security;
alter table public.labour_attendance enable row level security;
alter table public.labour_wage_rates enable row level security;
alter table public.labour_wage_periods enable row level security;
alter table public.labour_wage_lines enable row level security;
alter table public.labour_advances enable row level security;
alter table public.labour_advance_recoveries enable row level security;

grant all on public.labour_trades to service_role;
grant all on public.labour_attendance_periods to service_role;
grant all on public.labour_attendance_day_locks to service_role;
grant all on public.labour_attendance to service_role;
grant all on public.labour_wage_rates to service_role;
grant all on public.labour_wage_periods to service_role;
grant all on public.labour_wage_lines to service_role;
grant all on public.labour_advances to service_role;
grant all on public.labour_advance_recoveries to service_role;

insert into public.erp_modules (module_code, module_name, module_group, route, status, sort_order)
values
  ('labour_trades', 'Labour Categories', 'labour_management', '/labour/trades', 'active', 3),
  ('labour_attendance', 'Mark Labour Attendance', 'labour_management', '/labour/attendance/daily', 'active', 4),
  ('labour_attendance_approval', 'Labour Attendance Approval', 'labour_management', '/labour/muster', 'active', 5),
  ('labour_wage_rates', 'Labour Wage Rates', 'labour_management', '/labour/workers', 'active', 6),
  ('labour_wages', 'Wage Register', 'labour_management', '/labour/wages', 'active', 7),
  ('labour_wage_approval', 'Labour Wage Approval', 'labour_management', '/labour/wages', 'active', 8),
  ('labour_advances', 'Labour Advances', 'labour_management', '/labour/advances', 'active', 9)
on conflict (module_code) do update set
  module_name = excluded.module_name,
  module_group = excluded.module_group,
  route = excluded.route,
  status = excluded.status,
  sort_order = excluded.sort_order;

with trade_seed(trade_name, trade_code) as (
  values
    ('Mason', 'MAS'), ('Helper', 'HEL'), ('Carpenter', 'CAR'), ('Bar Bender', 'BAR'),
    ('Steel Fixer', 'STL'), ('Welder', 'WEL'), ('Electrician', 'ELE'), ('Plumber', 'PLU'),
    ('Painter', 'PAI'), ('Scaffolder', 'SCA'), ('Rigger', 'RIG'), ('Crane Operator', 'CRO'),
    ('JCB Operator', 'JCB'), ('Plant Operator', 'PLO'), ('Pump Operator', 'PUO'), ('Driver', 'DRI'),
    ('Security Guard', 'SEC'), ('Store Helper', 'STO'), ('Housekeeping', 'HOU'),
    ('General Labour', 'GEN'), ('Supervisor', 'SUP'), ('Foreman', 'FOR'), ('Other', 'OTH')
)
insert into public.labour_trades (organization_id, trade_name, trade_code, status)
select o.id, s.trade_name, s.trade_code, 'active'
from public.organizations o
cross join trade_seed s
where not exists (
  select 1 from public.labour_trades t
  where t.organization_id = o.id
    and upper(regexp_replace(trim(t.trade_name), '\s+', ' ', 'g')) = upper(regexp_replace(trim(s.trade_name), '\s+', ' ', 'g'))
    and t.status <> 'deleted'
);

with modules(module_code, action_code) as (
  values
    ('labour_trades','view'), ('labour_trades','add'), ('labour_trades','edit'), ('labour_trades','delete'), ('labour_trades','export'),
    ('labour_attendance','view'), ('labour_attendance','add'), ('labour_attendance','edit'), ('labour_attendance','submit'), ('labour_attendance','export'),
    ('labour_attendance_approval','view'), ('labour_attendance_approval','approve'), ('labour_attendance_approval','reject'),
    ('labour_wage_rates','view'), ('labour_wage_rates','add'), ('labour_wage_rates','edit'), ('labour_wage_rates','delete'), ('labour_wage_rates','export'),
    ('labour_wages','view'), ('labour_wages','add'), ('labour_wages','edit'), ('labour_wages','submit'), ('labour_wages','export'),
    ('labour_wage_approval','view'), ('labour_wage_approval','approve'), ('labour_wage_approval','reject'),
    ('labour_advances','view'), ('labour_advances','add'), ('labour_advances','edit'), ('labour_advances','delete'), ('labour_advances','approve'), ('labour_advances','export')
),
super_admin_roles as (
  select id from public.roles where lower(role_code) = 'super_admin'
)
insert into public.role_permissions (role_id, module_code, action_code, allowed)
select r.id, m.module_code, m.action_code, true
from super_admin_roles r
cross join modules m
where not exists (
  select 1 from public.role_permissions rp
  where rp.role_id = r.id and rp.module_code = m.module_code and rp.action_code = m.action_code
);

commit;
