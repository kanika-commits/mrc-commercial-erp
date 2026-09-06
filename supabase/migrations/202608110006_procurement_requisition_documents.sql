-- Purchase Requisition attachment foundation. This migration is intentionally unapplied.

create table if not exists public.purchase_requisition_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  requisition_id uuid not null references public.purchase_requisitions(id) on delete restrict,
  storage_provider text not null default 'supabase',
  storage_bucket text not null,
  storage_key text not null,
  original_file_name text not null,
  mime_type text,
  size_bytes bigint,
  checksum text,
  uploaded_by uuid,
  uploaded_by_name text,
  uploaded_by_email text,
  uploaded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  status text not null default 'active' check (status in ('active', 'deleted'))
);

create index if not exists purchase_requisition_documents_requisition_idx
  on public.purchase_requisition_documents (requisition_id, status, uploaded_at desc);

create index if not exists purchase_requisition_documents_organization_idx
  on public.purchase_requisition_documents (organization_id, status, uploaded_at desc);

alter table public.purchase_requisition_documents enable row level security;

grant all on public.purchase_requisition_documents to service_role;

insert into storage.buckets (id, name, public)
values ('purchase-requisition-documents', 'purchase-requisition-documents', false)
on conflict (id) do update set public = false;
