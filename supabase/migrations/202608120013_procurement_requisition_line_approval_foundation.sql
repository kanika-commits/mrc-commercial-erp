-- Additive foundation for independent Purchase Requisition line approval.
-- Workflow RPCs, backfill, APIs, and UI are intentionally deferred.

begin;

create table if not exists public.purchase_requisition_line_approval_state (
  id uuid primary key default gen_random_uuid(),
  requisition_id uuid not null references public.purchase_requisitions(id) on delete restrict,
  requisition_item_line_key uuid not null,
  workflow_version integer not null check (workflow_version > 0),
  submission_cycle integer not null check (submission_cycle > 0),
  current_approval_layer integer check (current_approval_layer is null or current_approval_layer between 1 and 3),
  approval_status text not null check (approval_status in ('pending', 'approved', 'sent_back', 'rejected', 'superseded')),
  final_approved_at timestamptz,
  final_approved_by uuid,
  final_approved_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint purchase_requisition_line_approval_state_scope_unique
    unique (requisition_id, requisition_item_line_key)
);

create index if not exists purchase_requisition_line_approval_state_queue_idx
  on public.purchase_requisition_line_approval_state (requisition_id, approval_status, current_approval_layer);

create index if not exists purchase_requisition_line_approval_state_status_layer_idx
  on public.purchase_requisition_line_approval_state (approval_status, current_approval_layer, requisition_id);

create table if not exists public.purchase_requisition_line_approval_steps (
  id uuid primary key default gen_random_uuid(),
  requisition_id uuid not null references public.purchase_requisitions(id) on delete restrict,
  requisition_item_line_key uuid not null,
  workflow_version integer not null check (workflow_version > 0),
  submission_cycle integer not null check (submission_cycle > 0),
  layer_number integer not null check (layer_number between 1 and 3),
  stage_name text not null check (length(trim(stage_name)) > 0),
  approver_user_id uuid not null references public.profiles(id) on delete restrict,
  approver_name_snapshot text,
  approver_email_snapshot text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'sent_back', 'rejected', 'superseded')),
  acted_by uuid references public.profiles(id) on delete set null,
  acted_by_name text,
  acted_by_email text,
  action_note text,
  acted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint purchase_requisition_line_approval_steps_unique
    unique (requisition_id, submission_cycle, requisition_item_line_key, layer_number)
);

create index if not exists purchase_requisition_line_approval_steps_current_idx
  on public.purchase_requisition_line_approval_steps
  (requisition_id, submission_cycle, requisition_item_line_key, status, layer_number);

create index if not exists purchase_requisition_line_approval_steps_approver_idx
  on public.purchase_requisition_line_approval_steps
  (approver_user_id, status, requisition_id, submission_cycle, layer_number);

alter table public.purchase_requisition_line_approval_state enable row level security;
alter table public.purchase_requisition_line_approval_steps enable row level security;

revoke all on table public.purchase_requisition_line_approval_state from public, anon, authenticated;
revoke all on table public.purchase_requisition_line_approval_steps from public, anon, authenticated;

grant all on table public.purchase_requisition_line_approval_state to service_role;
grant all on table public.purchase_requisition_line_approval_steps to service_role;

commit;
