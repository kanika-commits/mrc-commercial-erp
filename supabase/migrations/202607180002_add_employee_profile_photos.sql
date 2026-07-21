begin;

alter table public.hr_employees
  add column if not exists photo_storage_path text,
  add column if not exists photo_updated_at timestamptz;

insert into storage.buckets (id, name, public)
values ('employee-photos', 'employee-photos', false)
on conflict (id) do nothing;

commit;
