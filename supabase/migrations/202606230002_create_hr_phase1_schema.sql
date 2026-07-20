create table if not exists public.hr_departments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  department_name text not null,
  department_code text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  unique (organization_id, department_name)
);

create table if not exists public.hr_designations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  department_id uuid references public.hr_departments(id) on delete set null,
  designation_name text not null,
  designation_code text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  unique (organization_id, designation_name)
);

create table if not exists public.hr_employees (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  company_id uuid not null references public.companies(id) on delete restrict,
  site_id uuid references public.sites(id) on delete set null,
  employee_code text not null,
  employee_name text not null,
  email text,
  phone text,
  department_id uuid references public.hr_departments(id) on delete set null,
  designation_id uuid references public.hr_designations(id) on delete set null,
  reporting_manager_id uuid references public.hr_employees(id) on delete set null,
  date_of_joining date,
  employment_type text,
  status text not null default 'active',
  created_by uuid,
  created_by_name text,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_by_name text,
  updated_by_email text,
  updated_at timestamptz,
  check (reporting_manager_id is null or reporting_manager_id <> id),
  unique (organization_id, employee_code)
);

create table if not exists public.reimbursement_claims (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  company_id uuid not null references public.companies(id) on delete restrict,
  site_id uuid references public.sites(id) on delete set null,
  employee_id uuid not null references public.hr_employees(id) on delete restrict,
  claim_number text not null,
  claim_date date not null,
  claim_type text,
  description text,
  claim_amount numeric not null default 0,
  approved_amount numeric,
  status text not null default 'Draft',
  approval_status text not null default 'Pending',
  submitted_at timestamptz,
  approved_by uuid,
  approved_by_name text,
  approved_by_email text,
  approved_at timestamptz,
  rejected_by uuid,
  rejected_by_name text,
  rejected_by_email text,
  rejected_at timestamptz,
  rejection_reason text,
  created_by uuid,
  created_by_name text,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_by_name text,
  updated_by_email text,
  updated_at timestamptz,
  unique (organization_id, claim_number)
);

create table if not exists public.reimbursement_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  reimbursement_claim_id uuid not null references public.reimbursement_claims(id) on delete cascade,
  document_type text,
  file_name text,
  file_url text,
  file_path text,
  mime_type text,
  uploaded_by uuid,
  uploaded_by_name text,
  uploaded_by_email text,
  uploaded_at timestamptz not null default now()
);

create table if not exists public.reimbursement_status_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  reimbursement_claim_id uuid not null references public.reimbursement_claims(id) on delete cascade,
  from_status text,
  to_status text not null,
  action text not null,
  remarks text,
  changed_by uuid,
  changed_by_name text,
  changed_by_email text,
  changed_at timestamptz not null default now()
);

create index if not exists hr_departments_organization_idx
  on public.hr_departments (organization_id);

create index if not exists hr_designations_organization_idx
  on public.hr_designations (organization_id);

create index if not exists hr_designations_department_idx
  on public.hr_designations (department_id);

create index if not exists hr_employees_organization_idx
  on public.hr_employees (organization_id);

create index if not exists hr_employees_company_idx
  on public.hr_employees (company_id);

create index if not exists hr_employees_site_idx
  on public.hr_employees (site_id);

create index if not exists hr_employees_manager_idx
  on public.hr_employees (reporting_manager_id);

create index if not exists hr_employees_department_idx
  on public.hr_employees (department_id);

create index if not exists hr_employees_designation_idx
  on public.hr_employees (designation_id);

create index if not exists reimbursement_claims_organization_idx
  on public.reimbursement_claims (organization_id);

create index if not exists reimbursement_claims_company_idx
  on public.reimbursement_claims (company_id);

create index if not exists reimbursement_claims_site_idx
  on public.reimbursement_claims (site_id);

create index if not exists reimbursement_claims_employee_idx
  on public.reimbursement_claims (employee_id);

create index if not exists reimbursement_claims_approval_status_idx
  on public.reimbursement_claims (approval_status);

create index if not exists reimbursement_claims_status_idx
  on public.reimbursement_claims (status);

create index if not exists reimbursement_documents_claim_idx
  on public.reimbursement_documents (reimbursement_claim_id);

create index if not exists reimbursement_documents_organization_idx
  on public.reimbursement_documents (organization_id);

create index if not exists reimbursement_status_history_claim_idx
  on public.reimbursement_status_history (reimbursement_claim_id);

create index if not exists reimbursement_status_history_organization_idx
  on public.reimbursement_status_history (organization_id);

insert into public.erp_module_groups (
  module_code,
  module_name,
  route,
  sort_order,
  status
)
select
  'hr',
  'HR',
  '/modules/hr',
  50,
  'active'
where not exists (
  select 1 from public.erp_module_groups where module_code = 'hr'
);

insert into public.erp_modules (
  module_group,
  module_code,
  module_name,
  route,
  sort_order,
  status
)
select
  'hr',
  'hr_employees',
  'Employees',
  '/hr/employees',
  10,
  'active'
where not exists (
  select 1 from public.erp_modules where module_code = 'hr_employees'
);

insert into public.erp_modules (
  module_group,
  module_code,
  module_name,
  route,
  sort_order,
  status
)
select
  'hr',
  'reimbursements',
  'Reimbursements',
  '/hr/reimbursements',
  20,
  'active'
where not exists (
  select 1 from public.erp_modules where module_code = 'reimbursements'
);

insert into public.role_permissions (
  role_id,
  module_code,
  action_code,
  allowed
)
select
  roles.id,
  module_actions.module_code,
  module_actions.action_code,
  true
from public.roles
cross join (
  values
    ('hr_employees', 'view'),
    ('hr_employees', 'add'),
    ('hr_employees', 'edit'),
    ('hr_employees', 'delete'),
    ('hr_employees', 'upload'),
    ('hr_employees', 'export'),
    ('reimbursements', 'view'),
    ('reimbursements', 'add'),
    ('reimbursements', 'edit'),
    ('reimbursements', 'delete'),
    ('reimbursements', 'upload'),
    ('reimbursements', 'submit'),
    ('reimbursements', 'approve'),
    ('reimbursements', 'reject'),
    ('reimbursements', 'mark_paid'),
    ('reimbursements', 'export')
) as module_actions(module_code, action_code)
where roles.role_code = 'super_admin'
  and not exists (
    select 1
    from public.role_permissions existing
    where existing.role_id = roles.id
      and existing.module_code = module_actions.module_code
      and existing.action_code = module_actions.action_code
  );

grant all on table public.hr_departments to anon;
grant all on table public.hr_departments to authenticated;
grant all on table public.hr_departments to service_role;

grant all on table public.hr_designations to anon;
grant all on table public.hr_designations to authenticated;
grant all on table public.hr_designations to service_role;

grant all on table public.hr_employees to anon;
grant all on table public.hr_employees to authenticated;
grant all on table public.hr_employees to service_role;

grant all on table public.reimbursement_claims to anon;
grant all on table public.reimbursement_claims to authenticated;
grant all on table public.reimbursement_claims to service_role;

grant all on table public.reimbursement_documents to anon;
grant all on table public.reimbursement_documents to authenticated;
grant all on table public.reimbursement_documents to service_role;

grant all on table public.reimbursement_status_history to anon;
grant all on table public.reimbursement_status_history to authenticated;
grant all on table public.reimbursement_status_history to service_role;
