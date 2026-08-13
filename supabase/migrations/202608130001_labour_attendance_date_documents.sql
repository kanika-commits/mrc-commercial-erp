-- Standard Labour Attendance date-level supporting PDF.
-- Unapplied migration. Adds one private PDF attachment per period/date.

begin;

create extension if not exists pgcrypto;

create table if not exists public.labour_attendance_date_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete restrict,
  site_id uuid not null references public.sites(id) on delete restrict,
  period_id uuid not null references public.labour_attendance_periods(id) on delete restrict,
  attendance_date date not null,
  storage_provider text not null default 'supabase',
  storage_bucket text not null,
  storage_key text not null,
  original_file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  checksum text,
  is_active boolean not null default true,
  replaced_by_document_id uuid references public.labour_attendance_date_documents(id) on delete set null,
  uploaded_by uuid,
  uploaded_by_name text,
  uploaded_by_email text,
  uploaded_at timestamptz not null default now(),
  deleted_by uuid,
  deleted_by_name text,
  deleted_by_email text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  constraint labour_attendance_date_documents_pdf_chk check (mime_type = 'application/pdf')
);

create unique index if not exists labour_attendance_date_documents_active_uidx
  on public.labour_attendance_date_documents (period_id, attendance_date)
  where is_active = true;

create index if not exists labour_attendance_date_documents_scope_idx
  on public.labour_attendance_date_documents (organization_id, company_id, site_id, attendance_date, is_active);

alter table public.labour_attendance_date_documents enable row level security;

revoke all on table public.labour_attendance_date_documents from public, anon, authenticated;
grant all on table public.labour_attendance_date_documents to service_role;

commit;
