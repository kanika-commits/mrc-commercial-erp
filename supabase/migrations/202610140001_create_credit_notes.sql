-- Prepared only. Apply separately after Credit Note business rules and filing destination are approved.
-- This migration is intentionally independent of Debit Notes.
create table if not exists public.credit_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  work_order_id uuid not null,
  ra_bill_id uuid,
  vendor_id uuid not null,
  credit_note_number text not null,
  credit_note_date date,
  credit_note_type text,
  reason text,
  gross_amount numeric not null default 0,
  gst_amount numeric not null default 0,
  total_amount numeric not null default 0,
  status text not null default 'Draft',
  approval_status text not null default 'Pending',
  created_by_name text,
  created_by_email text,
  approved_by_name text,
  approved_by_email text,
  approved_at timestamptz,
  rejected_by_name text,
  rejected_by_email text,
  rejected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  drive_filing_status text not null default 'not_started',
  drive_filing_error text,
  unique (organization_id, credit_note_number)
);

create table if not exists public.credit_note_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  credit_note_id uuid not null references public.credit_notes(id) on delete cascade,
  file_name text,
  file_url text,
  uploaded_at timestamptz not null default now()
);

create table if not exists public.credit_note_rejections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  credit_note_id uuid not null references public.credit_notes(id) on delete cascade,
  rejected_by_name text,
  rejected_by_email text,
  rejection_reason text not null,
  rejected_at timestamptz not null default now()
);

create table if not exists public.credit_note_audit (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  credit_note_id uuid,
  credit_note_number text,
  action text not null,
  reason text,
  actor_id uuid,
  actor_email text,
  prior_status text,
  new_status text,
  created_at timestamptz not null default now()
);

create index if not exists idx_credit_notes_work_order_id on public.credit_notes(work_order_id);
create index if not exists idx_credit_notes_approval_status on public.credit_notes(approval_status);
create index if not exists idx_credit_note_documents_note_id on public.credit_note_documents(credit_note_id);
create index if not exists idx_credit_note_audit_note_id on public.credit_note_audit(credit_note_id);
create index if not exists idx_credit_notes_drive_filing_status on public.credit_notes(drive_filing_status);

grant all on public.credit_notes to anon, authenticated, service_role;
grant all on public.credit_note_documents to anon, authenticated, service_role;
grant all on public.credit_note_rejections to anon, authenticated, service_role;
grant all on public.credit_note_audit to anon, authenticated, service_role;

insert into storage.buckets (id, name, public)
values ('credit-note-documents', 'credit-note-documents', false)
on conflict (id) do nothing;

alter table public.work_order_drive_folders
  add column if not exists credit_notes_folder_id text;
