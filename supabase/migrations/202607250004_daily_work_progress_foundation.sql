begin;

alter table public.labour_daily_work_logs
  add column if not exists work_period text not null default 'regular',
  add column if not exists labour_count integer;

update public.labour_daily_work_logs
set work_period = 'regular'
where work_period is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'labour_daily_work_logs_work_period_check'
      and conrelid = 'public.labour_daily_work_logs'::regclass
  ) then
    alter table public.labour_daily_work_logs
      add constraint labour_daily_work_logs_work_period_check
      check (work_period in ('regular', 'overtime'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'labour_daily_work_logs_labour_count_check'
      and conrelid = 'public.labour_daily_work_logs'::regclass
  ) then
    alter table public.labour_daily_work_logs
      add constraint labour_daily_work_logs_labour_count_check
      check (labour_count is null or labour_count > 0);
  end if;
end $$;

alter table public.labour_photo_evidence
  add column if not exists captured_at timestamptz,
  add column if not exists captured_by uuid,
  add column if not exists captured_by_name text,
  add column if not exists captured_by_email text,
  add column if not exists capture_source text,
  add column if not exists verification_metadata jsonb default '{}'::jsonb;

create index if not exists labour_work_logs_daily_progress_idx
  on public.labour_daily_work_logs (organization_id, company_id, site_id, contractor_profile_id, work_date, work_period, status);

create index if not exists labour_photo_evidence_capture_idx
  on public.labour_photo_evidence (reference_type, reference_id, photo_type, is_active, captured_at);

commit;
