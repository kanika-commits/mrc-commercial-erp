begin;

create table if not exists public.employee_signature_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  employee_id uuid not null references public.hr_employees(id) on delete cascade,
  storage_provider text not null default 'supabase',
  storage_bucket text not null,
  storage_key text not null,
  original_file_name text,
  mime_type text not null,
  size_bytes bigint not null,
  initials text,
  display_title text,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_by_name text,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_by_name text,
  updated_by_email text,
  updated_at timestamptz,
  constraint employee_signature_profiles_size_check check (size_bytes >= 0),
  constraint employee_signature_profiles_storage_provider_check check (length(trim(storage_provider)) > 0),
  constraint employee_signature_profiles_storage_bucket_check check (length(trim(storage_bucket)) > 0),
  constraint employee_signature_profiles_storage_key_check check (length(trim(storage_key)) > 0)
);

create unique index if not exists employee_signature_profiles_one_active_uidx
  on public.employee_signature_profiles (employee_id)
  where is_active = true;

create index if not exists employee_signature_profiles_org_employee_idx
  on public.employee_signature_profiles (organization_id, employee_id);

alter table public.employee_signature_profiles enable row level security;

revoke all on table public.employee_signature_profiles from anon;
revoke all on table public.employee_signature_profiles from authenticated;
grant all on table public.employee_signature_profiles to service_role;

insert into storage.buckets (id, name, public)
values ('employee-signatures', 'employee-signatures', false)
on conflict (id) do nothing;

commit;
