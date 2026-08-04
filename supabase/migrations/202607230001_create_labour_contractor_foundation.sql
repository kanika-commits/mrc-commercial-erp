begin;

do $$
begin
  if to_regclass('public.erp_module_groups') is not null then
    insert into public.erp_module_groups (module_code, module_name, route, sort_order, status)
    values ('labour_management', 'Labour Management', '/labour', 40, 'active')
    on conflict (module_code) do nothing;
  end if;

  if to_regclass('public.erp_modules') is not null then
    insert into public.erp_modules (module_group, module_code, module_name, route, sort_order, status)
    values
      ('labour_management', 'labour_workers', 'Labourers', '/labour/workers', 1, 'active'),
      ('labour_management', 'labour_contractors', 'Labour Contractors', '/labour/contractors', 2, 'active'),
      ('labour_management', 'labour_import', 'Labour Import', '/labour/workers/import', 3, 'active'),
      ('labour_management', 'labour_deployments', 'Labour Deployments', '/labour/workers', 4, 'active'),
      ('labour_management', 'labour_documents', 'Labour Documents', '/labour/workers', 5, 'active')
    on conflict (module_code) do nothing;
  end if;
end $$;

create table if not exists public.labour_contractor_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  vendor_id uuid not null references public.vendors(id) on delete restrict,
  contractor_code text,
  contractor_status text not null default 'active'
    check (contractor_status in ('active', 'inactive', 'suspended', 'blacklisted')),
  labour_licence_number text,
  labour_licence_valid_from date,
  labour_licence_valid_to date,
  epf_registration_number text,
  esi_registration_number text,
  principal_employer_name text,
  default_supervisor_name text,
  default_supervisor_phone text,
  maximum_labour_capacity integer,
  remarks text,
  created_by uuid,
  created_by_name text,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_by_name text,
  updated_by_email text,
  updated_at timestamptz,
  constraint labour_contractor_profiles_vendor_unique unique (vendor_id),
  constraint labour_contractor_profiles_org_code_unique unique (organization_id, contractor_code)
);

create table if not exists public.labour_workers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  labour_code text not null,
  worker_name text not null,
  father_or_husband_name text,
  gender text,
  date_of_birth date,
  mobile_number text,
  alternate_mobile_number text,
  aadhaar_number text,
  uan_number text,
  esi_number text,
  bank_account_number text,
  bank_ifsc text,
  bank_name text,
  trade text,
  skill_level text check (skill_level is null or skill_level in ('unskilled', 'semi_skilled', 'skilled', 'highly_skilled')),
  worker_type text not null default 'contractor_labour'
    check (worker_type in ('contractor_labour', 'direct_labour')),
  date_of_joining date,
  date_of_exit date,
  status text not null default 'active'
    check (status in ('active', 'inactive', 'exited', 'suspended', 'deleted')),
  current_contractor_profile_id uuid references public.labour_contractor_profiles(id) on delete set null,
  current_company_id uuid references public.companies(id) on delete set null,
  current_site_id uuid references public.sites(id) on delete set null,
  current_work_order_id uuid references public.work_orders(id) on delete set null,
  photo_storage_provider text,
  photo_storage_bucket text,
  photo_storage_key text,
  remarks text,
  created_by uuid,
  created_by_name text,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_by_name text,
  updated_by_email text,
  updated_at timestamptz,
  constraint labour_workers_org_code_unique unique (organization_id, labour_code)
);

create unique index if not exists labour_workers_aadhaar_unique_idx
  on public.labour_workers (organization_id, aadhaar_number)
  where aadhaar_number is not null and btrim(aadhaar_number) <> '' and status <> 'deleted';

create unique index if not exists labour_workers_uan_unique_idx
  on public.labour_workers (organization_id, uan_number)
  where uan_number is not null and btrim(uan_number) <> '' and status <> 'deleted';

create unique index if not exists labour_workers_esi_unique_idx
  on public.labour_workers (organization_id, esi_number)
  where esi_number is not null and btrim(esi_number) <> '' and status <> 'deleted';

create table if not exists public.labour_deployments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  labour_worker_id uuid not null references public.labour_workers(id) on delete cascade,
  contractor_profile_id uuid references public.labour_contractor_profiles(id) on delete set null,
  company_id uuid not null references public.companies(id) on delete restrict,
  site_id uuid not null references public.sites(id) on delete restrict,
  work_order_id uuid references public.work_orders(id) on delete set null,
  trade text,
  skill_level text check (skill_level is null or skill_level in ('unskilled', 'semi_skilled', 'skilled', 'highly_skilled')),
  wage_type text check (wage_type is null or wage_type in ('daily', 'monthly', 'hourly', 'piece_rate')),
  wage_rate numeric,
  effective_from date not null,
  effective_to date,
  status text not null default 'active' check (status in ('active', 'ended')),
  deployment_reason text,
  created_by uuid,
  created_by_name text,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_by_name text,
  updated_by_email text,
  updated_at timestamptz,
  constraint labour_deployments_date_order check (effective_to is null or effective_to >= effective_from)
);

create unique index if not exists labour_deployments_one_open_idx
  on public.labour_deployments (labour_worker_id)
  where effective_to is null and status = 'active';

create table if not exists public.labour_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  labour_worker_id uuid not null references public.labour_workers(id) on delete cascade,
  document_type text not null,
  document_name text not null,
  document_number text,
  issue_date date,
  expiry_date date,
  metadata jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  is_active boolean not null default true,
  replaced_by_document_id uuid references public.labour_documents(id) on delete set null,
  storage_provider text not null default 'supabase',
  storage_bucket text not null,
  storage_key text not null,
  original_file_name text not null,
  mime_type text,
  size_bytes bigint,
  checksum text,
  source_type text,
  source_url text,
  uploaded_by uuid,
  uploaded_by_name text,
  uploaded_by_email text,
  uploaded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  constraint labour_documents_type_check check (document_type in ('Aadhaar Card', 'Bank Proof', 'Photo', 'UAN Card', 'ESI Card', 'Police Verification', 'Medical Certificate', 'Skill Certificate', 'Experience Certificate', 'Other'))
);

create table if not exists public.labour_contractor_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  contractor_profile_id uuid not null references public.labour_contractor_profiles(id) on delete cascade,
  document_type text not null,
  document_name text not null,
  document_number text,
  issue_date date,
  expiry_date date,
  metadata jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  is_active boolean not null default true,
  replaced_by_document_id uuid references public.labour_contractor_documents(id) on delete set null,
  storage_provider text not null default 'supabase',
  storage_bucket text not null,
  storage_key text not null,
  original_file_name text not null,
  mime_type text,
  size_bytes bigint,
  checksum text,
  source_type text,
  source_url text,
  uploaded_by uuid,
  uploaded_by_name text,
  uploaded_by_email text,
  uploaded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  constraint labour_contractor_documents_type_check check (document_type in ('Labour Licence', 'EPF Registration', 'ESI Registration', 'PAN', 'GST Registration', 'Agreement', 'Work Order', 'Insurance', 'Other'))
);

create table if not exists public.labour_import_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  selected_company_id uuid references public.companies(id) on delete set null,
  selected_site_id uuid references public.sites(id) on delete set null,
  source_file_name text not null,
  source_file_hash text,
  source_file_size bigint,
  source_sheet_name text,
  status text not null default 'uploaded' check (status in ('uploaded', 'validated', 'executed', 'failed', 'cancelled')),
  mapping jsonb not null default '{}'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  notes text,
  created_by uuid,
  created_by_name text,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_by_name text,
  updated_by_email text,
  updated_at timestamptz,
  executed_by uuid,
  executed_by_name text,
  executed_by_email text,
  executed_at timestamptz
);

create table if not exists public.labour_import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.labour_import_batches(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete set null,
  source_row_number integer not null,
  raw_data jsonb not null default '{}'::jsonb,
  normalized_data jsonb not null default '{}'::jsonb,
  labour_code text,
  worker_name text,
  father_or_husband_name text,
  contractor_text text,
  company_text text,
  site_text text,
  work_order_text text,
  matched_contractor_profile_id uuid references public.labour_contractor_profiles(id) on delete set null,
  matched_company_id uuid references public.companies(id) on delete set null,
  matched_site_id uuid references public.sites(id) on delete set null,
  matched_work_order_id uuid references public.work_orders(id) on delete set null,
  matched_labour_worker_id uuid references public.labour_workers(id) on delete set null,
  validation_status text not null default 'pending' check (validation_status in ('pending', 'ready', 'warning', 'blocked', 'executed', 'failed', 'skipped')),
  validation_errors text[] not null default '{}',
  validation_warnings text[] not null default '{}',
  selected_action text not null default 'create' check (selected_action in ('create', 'skip', 'update_review')),
  execution_status text not null default 'pending' check (execution_status in ('pending', 'executed', 'failed', 'skipped')),
  created_labour_worker_id uuid references public.labour_workers(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create index if not exists labour_contractor_profiles_org_status_idx on public.labour_contractor_profiles (organization_id, contractor_status);
create index if not exists labour_workers_org_status_idx on public.labour_workers (organization_id, status);
create index if not exists labour_workers_current_scope_idx on public.labour_workers (organization_id, current_company_id, current_site_id, status);
create index if not exists labour_deployments_worker_date_idx on public.labour_deployments (labour_worker_id, effective_from desc);
create index if not exists labour_deployments_scope_idx on public.labour_deployments (organization_id, company_id, site_id, status);
create index if not exists labour_documents_worker_idx on public.labour_documents (labour_worker_id, is_active, document_type);
create index if not exists labour_contractor_documents_profile_idx on public.labour_contractor_documents (contractor_profile_id, is_active, document_type);
create index if not exists labour_import_batches_org_idx on public.labour_import_batches (organization_id, created_at desc);
create unique index if not exists labour_import_rows_batch_row_idx on public.labour_import_rows (batch_id, source_row_number);

create or replace function public.execute_labour_worker_import_row(
  p_row_id uuid,
  p_actor_id uuid,
  p_actor_name text,
  p_actor_email text
)
returns table(worker_id uuid, deployment_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.labour_import_rows%rowtype;
  v_batch public.labour_import_batches%rowtype;
  v_worker_id uuid;
  v_deployment_id uuid;
  v_joining_date date;
begin
  select * into v_row
  from public.labour_import_rows
  where id = p_row_id
  for update;

  if not found then
    raise exception 'Import row not found.';
  end if;

  select * into v_batch
  from public.labour_import_batches
  where id = v_row.batch_id
  for update;

  if not found then
    raise exception 'Import batch not found.';
  end if;

  if v_row.execution_status = 'executed' and v_row.created_labour_worker_id is not null then
    select d.id into v_deployment_id
    from public.labour_deployments d
    where d.labour_worker_id = v_row.created_labour_worker_id
      and d.status = 'active'
    order by d.created_at desc
    limit 1;
    worker_id := v_row.created_labour_worker_id;
    deployment_id := v_deployment_id;
    return next;
    return;
  end if;

  if v_row.selected_action <> 'create' or v_row.validation_status not in ('ready', 'warning') then
    raise exception 'Import row is not ready for creation.';
  end if;

  if exists (
    select 1 from public.labour_workers w
    where w.organization_id = v_batch.organization_id
      and w.status <> 'deleted'
      and (
        (v_row.labour_code is not null and btrim(v_row.labour_code) <> '' and w.labour_code = v_row.labour_code)
        or (
          nullif(btrim(v_row.normalized_data->>'aadhaar_number'), '') is not null
          and w.aadhaar_number = nullif(btrim(v_row.normalized_data->>'aadhaar_number'), '')
        )
      )
  ) then
    raise exception 'Labourer already exists.';
  end if;

  if v_row.matched_company_id is null or v_row.matched_site_id is null then
    raise exception 'Company and site are required for imported labourer.';
  end if;

  v_joining_date := nullif(v_row.normalized_data->>'date_of_joining', '')::date;

  insert into public.labour_workers (
    organization_id, labour_code, worker_name, father_or_husband_name, mobile_number,
    aadhaar_number, uan_number, esi_number, bank_account_number, bank_ifsc, bank_name,
    trade, skill_level, worker_type, date_of_joining, status, current_contractor_profile_id,
    current_company_id, current_site_id, current_work_order_id, remarks,
    created_by, created_by_name, created_by_email, updated_by, updated_by_name, updated_by_email, updated_at
  )
  values (
    v_batch.organization_id,
    coalesce(v_row.labour_code, v_row.normalized_data->>'labour_code'),
    coalesce(v_row.worker_name, v_row.normalized_data->>'worker_name'),
    nullif(v_row.normalized_data->>'father_or_husband_name', ''),
    nullif(v_row.normalized_data->>'mobile_number', ''),
    nullif(v_row.normalized_data->>'aadhaar_number', ''),
    nullif(v_row.normalized_data->>'uan_number', ''),
    nullif(v_row.normalized_data->>'esi_number', ''),
    nullif(v_row.normalized_data->>'bank_account_number', ''),
    nullif(v_row.normalized_data->>'bank_ifsc', ''),
    nullif(v_row.normalized_data->>'bank_name', ''),
    nullif(v_row.normalized_data->>'trade', ''),
    nullif(v_row.normalized_data->>'skill_level', ''),
    coalesce(nullif(v_row.normalized_data->>'worker_type', ''), 'contractor_labour'),
    v_joining_date,
    'active',
    v_row.matched_contractor_profile_id,
    v_row.matched_company_id,
    v_row.matched_site_id,
    v_row.matched_work_order_id,
    'Created from labour master import.',
    p_actor_id, p_actor_name, p_actor_email, p_actor_id, p_actor_name, p_actor_email, now()
  )
  returning id into v_worker_id;

  insert into public.labour_deployments (
    organization_id, labour_worker_id, contractor_profile_id, company_id, site_id,
    work_order_id, trade, skill_level, effective_from, status, deployment_reason,
    created_by, created_by_name, created_by_email, updated_by, updated_by_name, updated_by_email, updated_at
  )
  values (
    v_batch.organization_id,
    v_worker_id,
    v_row.matched_contractor_profile_id,
    v_row.matched_company_id,
    v_row.matched_site_id,
    v_row.matched_work_order_id,
    nullif(v_row.normalized_data->>'trade', ''),
    nullif(v_row.normalized_data->>'skill_level', ''),
    coalesce(v_joining_date, current_date),
    'active',
    'Initial deployment from import.',
    p_actor_id, p_actor_name, p_actor_email, p_actor_id, p_actor_name, p_actor_email, now()
  )
  returning id into v_deployment_id;

  worker_id := v_worker_id;
  deployment_id := v_deployment_id;
  return next;
end;
$$;

create or replace function public.transfer_labour_deployment(
  p_worker_id uuid,
  p_organization_id uuid,
  p_contractor_profile_id uuid,
  p_company_id uuid,
  p_site_id uuid,
  p_work_order_id uuid,
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
    work_order_id, trade, skill_level, wage_type, wage_rate, effective_from, effective_to,
    status, deployment_reason, created_by, created_by_name, created_by_email,
    updated_by, updated_by_name, updated_by_email, updated_at
  )
  values (
    p_organization_id, p_worker_id, p_contractor_profile_id, p_company_id, p_site_id,
    p_work_order_id, p_trade, p_skill_level, p_wage_type, p_wage_rate, p_effective_from,
    p_effective_to, case when p_effective_to is null then 'active' else 'ended' end,
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

alter table public.labour_contractor_profiles enable row level security;
alter table public.labour_workers enable row level security;
alter table public.labour_deployments enable row level security;
alter table public.labour_documents enable row level security;
alter table public.labour_contractor_documents enable row level security;
alter table public.labour_import_batches enable row level security;
alter table public.labour_import_rows enable row level security;

grant all on table public.labour_contractor_profiles to service_role;
grant all on table public.labour_workers to service_role;
grant all on table public.labour_deployments to service_role;
grant all on table public.labour_documents to service_role;
grant all on table public.labour_contractor_documents to service_role;
grant all on table public.labour_import_batches to service_role;
grant all on table public.labour_import_rows to service_role;

do $$
begin
  if to_regclass('public.roles') is not null and to_regclass('public.role_permissions') is not null then
    insert into public.role_permissions (role_id, module_code, action_code, allowed)
    select roles.id, permissions.module_code, permissions.action_code, true
    from public.roles
    cross join (
      values
        ('labour_contractors', 'view'), ('labour_contractors', 'add'), ('labour_contractors', 'edit'), ('labour_contractors', 'delete'), ('labour_contractors', 'upload'), ('labour_contractors', 'export'),
        ('labour_workers', 'view'), ('labour_workers', 'add'), ('labour_workers', 'edit'), ('labour_workers', 'delete'), ('labour_workers', 'upload'), ('labour_workers', 'export'),
        ('labour_deployments', 'view'), ('labour_deployments', 'add'), ('labour_deployments', 'edit'), ('labour_deployments', 'export'),
        ('labour_import', 'view'), ('labour_import', 'upload'), ('labour_import', 'execute'), ('labour_import', 'export'),
        ('labour_documents', 'view'), ('labour_documents', 'upload'), ('labour_documents', 'delete')
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
