alter table public.hr_employees
  add column if not exists personal_email text,
  add column if not exists personal_phone text;
