-- Engineer Daily Labour submissions must be scoped by engineer as well as contractor.
-- This preserves separate daily registers for multiple engineers working under the
-- same contractor/site/date.

begin;

alter table public.labour_daily_submissions
  add column if not exists engineer_employee_id uuid references public.hr_employees(id) on delete restrict,
  add column if not exists engineer_user_id uuid references public.profiles(id) on delete set null;

alter table public.labour_daily_submission_events
  add column if not exists engineer_employee_id uuid references public.hr_employees(id) on delete restrict,
  add column if not exists engineer_user_id uuid references public.profiles(id) on delete set null;

update public.labour_daily_submissions s
set engineer_employee_id = nullif(s.snapshot->>'engineer_employee_id', '')::uuid
where s.engineer_employee_id is null
  and nullif(s.snapshot->>'engineer_employee_id', '') is not null;

update public.labour_daily_submissions s
set engineer_user_id = e.user_id
from public.hr_employees e
where s.engineer_employee_id = e.id
  and s.engineer_user_id is null
  and e.user_id is not null;

update public.labour_daily_submission_events ev
set engineer_employee_id = s.engineer_employee_id,
    engineer_user_id = s.engineer_user_id
from public.labour_daily_submissions s
where ev.submission_id = s.id
  and ev.engineer_employee_id is null;

alter table public.labour_daily_submissions
  drop constraint if exists labour_daily_submissions_unique_scope;

create unique index if not exists labour_daily_submissions_engineer_scope_uidx
  on public.labour_daily_submissions (
    organization_id,
    company_id,
    site_id,
    work_date,
    contractor_profile_id,
    coalesce(engineer_employee_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where status <> 'cancelled';

create index if not exists labour_daily_submissions_engineer_queue_idx
  on public.labour_daily_submissions (
    organization_id,
    company_id,
    site_id,
    work_date,
    engineer_employee_id,
    contractor_profile_id,
    status
  );

create index if not exists labour_daily_submission_events_engineer_idx
  on public.labour_daily_submission_events (submission_id, engineer_employee_id, created_at desc);

commit;
