begin;

create table if not exists public.employee_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  employee_id uuid not null references public.hr_employees(id) on delete cascade,
  document_type text not null,
  document_name text not null,
  storage_path text not null,
  file_url text,
  mime_type text,
  file_size bigint,
  uploaded_by uuid,
  uploaded_by_name text,
  uploaded_by_email text,
  uploaded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

alter table public.employee_documents
  add column if not exists organization_id uuid,
  add column if not exists employee_id uuid,
  add column if not exists document_type text,
  add column if not exists document_name text,
  add column if not exists storage_path text,
  add column if not exists file_url text,
  add column if not exists mime_type text,
  add column if not exists file_size bigint,
  add column if not exists uploaded_by uuid,
  add column if not exists uploaded_by_name text,
  add column if not exists uploaded_by_email text,
  add column if not exists uploaded_at timestamptz default now(),
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'employee_documents_employee_id_fkey'
      and conrelid = 'public.employee_documents'::regclass
  ) then
    alter table public.employee_documents
      add constraint employee_documents_employee_id_fkey
      foreign key (employee_id) references public.hr_employees(id) on delete cascade;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'employee_documents_type_check'
      and conrelid = 'public.employee_documents'::regclass
  ) then
    alter table public.employee_documents
      add constraint employee_documents_type_check
      check (
        document_type in (
          'Aadhaar',
          'PAN',
          'Passport',
          'Driving Licence',
          'Resume',
          'Offer Letter',
          'Appointment Letter',
          'Joining Letter',
          'Employment Contract',
          'Confirmation Letter',
          '10th',
          '12th',
          'Graduation',
          'Post Graduation',
          'Diploma',
          'Certificates',
          'Increment Letter',
          'Promotion Letter',
          'Transfer Letter',
          'Warning Letter',
          'Appreciation Letter',
          'Bank Proof',
          'Cancelled Cheque',
          'PF',
          'ESI',
          'UAN',
          'Other'
        )
      ) not valid;
  end if;
end $$;

create index if not exists employee_documents_employee_uploaded_idx
  on public.employee_documents (employee_id, uploaded_at desc);

create index if not exists employee_documents_organization_uploaded_idx
  on public.employee_documents (organization_id, uploaded_at desc);

create index if not exists employee_documents_employee_type_name_idx
  on public.employee_documents (employee_id, document_type, lower(document_name));

alter table public.employee_documents enable row level security;

insert into storage.buckets (id, name, public)
values ('employee-documents', 'employee-documents', false)
on conflict (id) do nothing;

commit;
