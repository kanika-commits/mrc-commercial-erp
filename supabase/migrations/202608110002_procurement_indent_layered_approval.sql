-- Layered Indent approval schema foundation. This migration is intentionally unapplied.

alter table public.purchase_requisitions
  add column if not exists current_approval_layer integer,
  add column if not exists approval_workflow_version integer;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'purchase_requisitions_current_approval_layer_check') then
    alter table public.purchase_requisitions add constraint purchase_requisitions_current_approval_layer_check
      check (current_approval_layer is null or current_approval_layer between 1 and 3);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'purchase_requisitions_approval_workflow_version_check') then
    alter table public.purchase_requisitions add constraint purchase_requisitions_approval_workflow_version_check
      check (approval_workflow_version is null or approval_workflow_version > 0);
  end if;
end $$;

create table if not exists public.purchase_requisition_approval_configurations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete restrict,
  site_id uuid not null references public.sites(id) on delete restrict,
  layer_count integer not null check (layer_count in (2, 3)),
  workflow_version integer not null default 1 check (workflow_version > 0),
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_by uuid,
  created_by_name text,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_by_name text,
  updated_by_email text,
  updated_at timestamptz not null default now(),
  constraint purchase_requisition_approval_configurations_scope_unique unique (organization_id, company_id, site_id)
);

create table if not exists public.purchase_requisition_approval_layers (
  id uuid primary key default gen_random_uuid(),
  configuration_id uuid not null references public.purchase_requisition_approval_configurations(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete restrict,
  site_id uuid not null references public.sites(id) on delete restrict,
  workflow_version integer not null check (workflow_version > 0),
  layer_number integer not null check (layer_number between 1 and 3),
  stage_name text not null check (length(trim(stage_name)) > 0),
  approver_user_id uuid not null references public.profiles(id) on delete restrict,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_by uuid,
  created_by_name text,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_by_name text,
  updated_by_email text,
  updated_at timestamptz not null default now(),
  constraint purchase_requisition_approval_layers_unique unique (configuration_id, workflow_version, layer_number)
);

create table if not exists public.purchase_requisition_approval_configuration_events (
  id uuid primary key default gen_random_uuid(),
  configuration_id uuid references public.purchase_requisition_approval_configurations(id) on delete set null,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete restrict,
  site_id uuid not null references public.sites(id) on delete restrict,
  previous_workflow_version integer,
  new_workflow_version integer not null check (new_workflow_version > 0),
  previous_snapshot jsonb,
  new_snapshot jsonb not null,
  event_note text,
  created_by uuid,
  created_by_name text,
  created_by_email text,
  created_at timestamptz not null default now()
);

create table if not exists public.purchase_requisition_approval_steps (
  id uuid primary key default gen_random_uuid(),
  requisition_id uuid not null references public.purchase_requisitions(id) on delete restrict,
  workflow_version integer not null check (workflow_version > 0),
  submission_cycle integer not null default 1 check (submission_cycle > 0),
  layer_number integer not null check (layer_number between 1 and 3),
  stage_name text not null check (length(trim(stage_name)) > 0),
  approver_user_id uuid not null references public.profiles(id) on delete restrict,
  approver_name_snapshot text,
  approver_email_snapshot text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'sent_back', 'rejected', 'superseded')),
  acted_at timestamptz,
  acted_by uuid,
  acted_by_name text,
  acted_by_email text,
  action_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint purchase_requisition_approval_steps_unique unique (requisition_id, submission_cycle, layer_number)
);

create index if not exists purchase_requisition_approval_config_scope_idx
  on public.purchase_requisition_approval_configurations (organization_id, company_id, site_id, status);
create index if not exists purchase_requisition_approval_steps_current_idx
  on public.purchase_requisition_approval_steps (requisition_id, submission_cycle, layer_number, status);
create index if not exists purchase_requisition_approval_steps_approver_idx
  on public.purchase_requisition_approval_steps (approver_user_id, status, requisition_id);

alter table public.purchase_requisition_approval_configurations enable row level security;
alter table public.purchase_requisition_approval_layers enable row level security;
alter table public.purchase_requisition_approval_configuration_events enable row level security;
alter table public.purchase_requisition_approval_steps enable row level security;

grant all on public.purchase_requisition_approval_configurations to service_role;
grant all on public.purchase_requisition_approval_layers to service_role;
grant all on public.purchase_requisition_approval_configuration_events to service_role;
grant all on public.purchase_requisition_approval_steps to service_role;

insert into public.erp_modules (module_group, module_code, module_name, route, sort_order, status)
values ('purchase', 'purchase_requisition_approval_configuration', 'Indent Approval Configuration', '/purchase/requisitions/configuration', 45, 'active')
on conflict (module_code) do update set module_group = excluded.module_group, module_name = excluded.module_name, route = excluded.route, sort_order = excluded.sort_order, status = excluded.status;

with module_actions(module_code, action_code) as (
  values ('purchase_requisition_approval_configuration', 'view'), ('purchase_requisition_approval_configuration', 'edit')
)
insert into public.role_permissions (role_id, module_code, action_code, allowed)
select r.id, ma.module_code, ma.action_code, true
from public.roles r
cross join module_actions ma
where r.role_code in ('platform_owner', 'super_admin')
  and not exists (
    select 1 from public.role_permissions rp
    where rp.role_id = r.id and rp.module_code = ma.module_code and rp.action_code = ma.action_code
  );
