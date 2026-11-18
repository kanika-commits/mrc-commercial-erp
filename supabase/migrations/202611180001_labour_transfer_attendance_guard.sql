-- Guard transfer deployment writes at the database boundary. Apply only after review.
create or replace function public.assert_labour_transfer_attendance_editable(
  p_organization_id uuid,
  p_company_id uuid,
  p_site_id uuid,
  p_contractor_profile_id uuid,
  p_attendance_date date
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period public.labour_attendance_periods%rowtype;
  v_status text;
begin
  if exists (
    select 1 from public.labour_attendance_day_locks
     where organization_id = p_organization_id and company_id = p_company_id and site_id = p_site_id
       and attendance_date = p_attendance_date
       and contractor_profile_id is not distinct from p_contractor_profile_id
       and is_locked = true
  ) then
    raise exception 'Attendance for site % on % is locked. Send it back and reopen it before transferring this worker.', p_site_id, p_attendance_date;
  end if;

  select * into v_period from public.labour_attendance_periods
   where organization_id = p_organization_id and company_id = p_company_id and site_id = p_site_id
     and contractor_profile_id is not distinct from p_contractor_profile_id
     and period_month = date_trunc('month', p_attendance_date)::date;
  if not found then return; end if;
  v_status := coalesce(v_period.summary->'date_statuses'->p_attendance_date::text->>'status', v_period.status);
  if v_status in ('reopened', 'draft') then return; end if;
  if v_status in ('finalized', 'approved') then
    raise exception 'Attendance for site % on % is finalized. Send it back and reopen it before transferring this worker.', p_site_id, p_attendance_date;
  end if;
  if v_status = 'submitted' or exists (
    select 1 from public.labour_attendance_submission_versions
     where period_id = v_period.id and attendance_date = p_attendance_date and status = 'submitted'
  ) then
    raise exception 'Attendance for site % on % is submitted. Send it back and reopen it before transferring this worker.', p_site_id, p_attendance_date;
  end if;
end;
$$;

create or replace function public.guard_labour_transfer_attendance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and old.status = 'active' and new.status = 'ended' and new.effective_to is not null then
    perform public.assert_labour_transfer_attendance_editable(old.organization_id, old.company_id, old.site_id, old.contractor_profile_id, new.effective_to + 1);
  end if;
  if tg_op = 'INSERT' and new.status = 'active' then
    perform public.assert_labour_transfer_attendance_editable(new.organization_id, new.company_id, new.site_id, new.contractor_profile_id, new.effective_from);
  end if;
  return new;
end;
$$;

drop trigger if exists labour_transfer_attendance_guard on public.labour_deployments;
create trigger labour_transfer_attendance_guard
before insert or update on public.labour_deployments
for each row execute function public.guard_labour_transfer_attendance();
