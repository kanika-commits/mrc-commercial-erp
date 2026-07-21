begin;

alter table public.hr_employees
  add column if not exists current_address_line1 text,
  add column if not exists current_address_line2 text,
  add column if not exists current_address_city text,
  add column if not exists current_address_state text,
  add column if not exists current_address_country text,
  add column if not exists current_address_pin_code text,
  add column if not exists permanent_address_line1 text,
  add column if not exists permanent_address_line2 text,
  add column if not exists permanent_address_city text,
  add column if not exists permanent_address_state text,
  add column if not exists permanent_address_country text,
  add column if not exists permanent_address_pin_code text;

update public.hr_employees
set current_address_line1 = current_address
where current_address_line1 is null
  and current_address is not null;

update public.hr_employees
set permanent_address_line1 = permanent_address
where permanent_address_line1 is null
  and permanent_address is not null;

create table if not exists public.employee_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid,
  employee_id uuid,
  document_type text,
  document_name text,
  storage_path text,
  file_url text,
  uploaded_by uuid,
  uploaded_at timestamptz default now(),
  created_at timestamptz default now(),
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
  add column if not exists updated_at timestamptz,
  add column if not exists document_number text,
  add column if not exists metadata jsonb default '{}'::jsonb,
  add column if not exists issue_date date,
  add column if not exists expiry_date date,
  add column if not exists issuing_authority text,
  add column if not exists issue_country text,
  add column if not exists issue_state text,
  add column if not exists remarks text,
  add column if not exists version integer not null default 1,
  add column if not exists is_active boolean not null default true,
  add column if not exists replaced_by_document_id uuid,
  add column if not exists updated_by uuid,
  add column if not exists updated_by_name text,
  add column if not exists updated_by_email text;

do $$
declare
  constraint_record record;
begin
  for constraint_record in
    select conname
    from pg_constraint
    where conrelid = 'public.employee_documents'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%document_type%'
  loop
    execute format(
      'alter table public.employee_documents drop constraint if exists %I',
      constraint_record.conname
    );
  end loop;

  alter table public.employee_documents
    add constraint employee_documents_type_check
    check (
      document_type in (
        'Employee Photo',
        'Aadhaar Card',
        'PAN Card',
        'Passport',
        'Driving Licence',
        'Voter ID',
        'ESIC Card',
        'PF Document',
        'Bank Proof',
        'Cancelled Cheque',
        'Employment Contract',
        'Offer Letter',
        'Appointment Letter',
        'Confirmation Letter',
        'Resignation Letter',
        'Relieving Letter',
        'Experience Letter',
        'Educational Certificate',
        'Professional Certificate',
        'Police Verification',
        'Medical Certificate',
        'Visa',
        'Work Permit',
        'Other',
        'Aadhaar',
        'PAN',
        'Resume',
        'Joining Letter',
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
        'PF',
        'ESI',
        'UAN'
      )
    ) not valid;
end $$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'employee_documents'
      and column_name = 'id'
      and udt_name = 'uuid'
  )
  and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'employee_documents'
      and column_name = 'replaced_by_document_id'
      and udt_name = 'uuid'
  )
  and not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.employee_documents'::regclass
      and conname = 'employee_documents_replaced_by_document_id_fkey'
  ) then
    alter table public.employee_documents
      add constraint employee_documents_replaced_by_document_id_fkey
      foreign key (replaced_by_document_id)
      references public.employee_documents(id)
      on delete set null;
  end if;
end $$;

create index if not exists employee_documents_employee_type_active_idx
  on public.employee_documents (employee_id, document_type, is_active, uploaded_at desc);

create index if not exists employee_documents_employee_version_idx
  on public.employee_documents (employee_id, document_type, version desc);

commit;
