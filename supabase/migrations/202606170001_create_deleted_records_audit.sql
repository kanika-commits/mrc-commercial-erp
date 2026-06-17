create table if not exists public.deleted_records_audit (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid,
  module_code text not null,
  document_type text not null,
  document_id uuid not null,
  document_number text,
  deleted_by_name text,
  deleted_by_email text,
  deleted_at timestamptz not null default now(),
  deletion_reason text not null,
  record_snapshot jsonb,
  related_snapshot jsonb,
  file_snapshot jsonb,
  created_at timestamptz not null default now()
);

create index if not exists deleted_records_audit_module_document_idx
  on public.deleted_records_audit (module_code, document_id);

create index if not exists deleted_records_audit_organization_idx
  on public.deleted_records_audit (organization_id);

