-- Structured immutable Purchase Requisition / Indent activity trail.
-- This migration is intentionally additive and must be applied manually.

begin;

create table if not exists public.purchase_requisition_activity_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete restrict,
  site_id uuid not null references public.sites(id) on delete restrict,
  requisition_id uuid not null references public.purchase_requisitions(id) on delete restrict,
  requisition_number_snapshot text not null check (length(trim(requisition_number_snapshot)) > 0),
  line_key uuid,
  item_id_snapshot uuid,
  item_code_snapshot text,
  item_name_snapshot text,
  action_type text not null check (length(trim(action_type)) > 0),
  changes jsonb,
  actor_user_id uuid references public.profiles(id) on delete set null,
  actor_name text,
  actor_email text,
  workflow_version integer check (workflow_version is null or workflow_version > 0),
  approval_cycle integer check (approval_cycle is null or approval_cycle > 0),
  approval_layer integer check (approval_layer is null or approval_layer between 1 and 3),
  approval_stage_name text,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists purchase_requisition_activity_events_requisition_idx
  on public.purchase_requisition_activity_events (requisition_id, created_at desc);

create index if not exists purchase_requisition_activity_events_scope_idx
  on public.purchase_requisition_activity_events (organization_id, company_id, site_id, created_at desc);

create index if not exists purchase_requisition_activity_events_line_idx
  on public.purchase_requisition_activity_events (requisition_id, line_key, created_at desc)
  where line_key is not null;

alter table public.purchase_requisition_activity_events enable row level security;

revoke all on table public.purchase_requisition_activity_events from public, anon, authenticated, service_role;
grant select, insert
on table public.purchase_requisition_activity_events
to service_role;

commit;
