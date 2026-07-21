alter table hr_employees
  add column if not exists date_of_birth date,
  add column if not exists gender text,
  add column if not exists nationality text,
  add column if not exists father_name text,
  add column if not exists mother_name text,
  add column if not exists spouse_name text,
  add column if not exists blood_group text,
  add column if not exists marital_status text,
  add column if not exists current_address text,
  add column if not exists permanent_address text,
  add column if not exists emergency_contact_name text,
  add column if not exists emergency_contact_phone text,
  add column if not exists emergency_contact_relationship text,
  add column if not exists remarks text,
  add column if not exists shift text,
  add column if not exists confirmation_date date,
  add column if not exists notice_period_from date,
  add column if not exists notice_period_to date,
  add column if not exists resignation_date date,
  add column if not exists date_of_exit date,
  add column if not exists exit_remark text;

create index if not exists hr_employees_status_idx
  on hr_employees(status);

create index if not exists hr_employees_date_of_joining_idx
  on hr_employees(date_of_joining);
