-- Prevent empty or internally inconsistent Labour Attendance submission snapshots.
begin;

create or replace function public.create_labour_attendance_submission_snapshot(
  p_period_id uuid,
  p_attendance_date date,
  p_actor jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period public.labour_attendance_periods%rowtype;
  v_actor_id uuid := nullif(p_actor->>'user_id', '')::uuid;
  v_actor_name text := nullif(p_actor->>'name', '');
  v_actor_email text := nullif(p_actor->>'email', '');
  v_version integer;
  v_snapshot_id uuid;
  v_previous_version_id uuid;
  v_status text;
  v_rows integer := 0;
  v_present integer := 0;
  v_absent integer := 0;
  v_half_day integer := 0;
  v_incomplete integer := 0;
  v_ot integer := 0;
  v_bonus integer := 0;
  v_inserted integer := 0;
  v_inserted_present integer := 0;
  v_inserted_absent integer := 0;
  v_inserted_half_day integer := 0;
  v_inserted_incomplete integer := 0;
  v_inserted_ot integer := 0;
  v_inserted_bonus integer := 0;
begin
  if v_actor_id is null then raise exception 'Authenticated actor is required.'; end if;
  select * into v_period from public.labour_attendance_periods where id = p_period_id for update;
  if not found then raise exception 'Attendance period not found.'; end if;
  v_status := coalesce(v_period.summary->'date_statuses'->p_attendance_date::text->>'status', 'draft');
  if v_status not in ('draft', 'reopened') then raise exception 'Only draft or reopened attendance can be submitted.'; end if;

  select id into v_previous_version_id
  from public.labour_attendance_submission_versions
  where period_id = p_period_id and attendance_date = p_attendance_date
  order by submission_version desc, submitted_at desc, id desc
  limit 1;

  select coalesce(max(submission_version), 0) + 1 into v_version
  from public.labour_attendance_submission_versions
  where period_id = p_period_id and attendance_date = p_attendance_date;

  create temporary table pg_temp.labour_submission_population on commit drop as
  select d.*, w.labour_code, w.worker_name, w.date_of_joining, w.date_of_exit,
    coalesce(v.vendor_name, cp.contractor_code) as contractor_name,
    coalesce(t.trade_name, d.trade) as trade_name,
    a.first_half_present, a.second_half_present, a.overtime_minutes,
    a.approved_overtime_minutes, a.bonus_minutes, a.remarks, a.source,
    case when a.first_half_present is null or a.second_half_present is null then 'incomplete'
      when a.first_half_present and a.second_half_present then 'present'
      when not a.first_half_present and not a.second_half_present then 'absent'
      else 'half_day' end as derived_status
  from public.labour_deployments d
  join public.labour_workers w on w.id = d.labour_worker_id
  left join public.labour_contractor_profiles cp on cp.id = d.contractor_profile_id
  left join public.vendors v on v.id = cp.vendor_id
  left join public.labour_trades t on t.id = d.labour_trade_id
  left join public.labour_attendance a on a.labour_worker_id = d.labour_worker_id
    and a.attendance_date = p_attendance_date and a.period_id = p_period_id
  where d.organization_id = v_period.organization_id
    and d.company_id = v_period.company_id
    and d.site_id = v_period.site_id
    and (v_period.contractor_profile_id is null or d.contractor_profile_id = v_period.contractor_profile_id)
    and (
      (v_status = 'reopened' and (
        (v_previous_version_id is not null and d.id in (select deployment_id from public.labour_attendance_submission_version_rows where submission_version_id = v_previous_version_id and deployment_id is not null))
        or (v_previous_version_id is null and d.id in (select distinct deployment_id from public.labour_attendance where period_id = p_period_id and attendance_date = p_attendance_date and deployment_id is not null))
      ))
      or (v_status = 'draft' and d.status in ('active', 'ended')
        and d.effective_from <= p_attendance_date
        and (d.effective_to is null or d.effective_to >= p_attendance_date)
        and (w.date_of_joining is null or w.date_of_joining <= p_attendance_date)
        and (w.date_of_exit is null or w.date_of_exit >= p_attendance_date))
    );

  select count(*), count(*) filter (where derived_status = 'present'), count(*) filter (where derived_status = 'absent'), count(*) filter (where derived_status = 'half_day'), count(*) filter (where derived_status = 'incomplete'), coalesce(sum(coalesce(overtime_minutes, 0)), 0), coalesce(sum(coalesce(bonus_minutes, 0)), 0)
  into v_rows, v_present, v_absent, v_half_day, v_incomplete, v_ot, v_bonus
  from pg_temp.labour_submission_population;
  if v_rows = 0 then raise exception 'No eligible labour attendance exists for this date.'; end if;
  if v_incomplete > 0 then raise exception 'Attendance is incomplete for % labourers.', v_incomplete; end if;

  insert into public.labour_attendance_submission_versions (
    organization_id, company_id, site_id, contractor_profile_id, period_id, attendance_date,
    submission_version, submitted_by, submitted_by_name, submitted_by_email, submitted_at,
    eligible_worker_count, present_count, absent_count, half_day_count, incomplete_count,
    overtime_minutes_total, bonus_minutes_total
  ) values (
    v_period.organization_id, v_period.company_id, v_period.site_id, v_period.contractor_profile_id,
    p_period_id, p_attendance_date, v_version, v_actor_id, v_actor_name, v_actor_email, now(),
    v_rows, v_present, v_absent, v_half_day, v_incomplete, v_ot, v_bonus
  ) returning id into v_snapshot_id;

  insert into public.labour_attendance_submission_version_rows (
    submission_version_id, labour_worker_id, deployment_id, labour_code_snapshot, worker_name_snapshot,
    contractor_name_snapshot, trade_snapshot, commercial_model_snapshot, first_half_present,
    second_half_present, derived_status, overtime_minutes, approved_overtime_minutes, bonus_minutes,
    remarks, source
  )
  select v_snapshot_id, labour_worker_id, id, labour_code, worker_name, contractor_name, trade_name,
    commercial_model, first_half_present, second_half_present, derived_status,
    coalesce(overtime_minutes, 0), coalesce(approved_overtime_minutes, 0), coalesce(bonus_minutes, 0), remarks, source
  from pg_temp.labour_submission_population;

  select count(*), count(*) filter (where derived_status = 'present'), count(*) filter (where derived_status = 'absent'), count(*) filter (where derived_status = 'half_day'), count(*) filter (where derived_status = 'incomplete'), coalesce(sum(coalesce(approved_overtime_minutes, overtime_minutes, 0)), 0), coalesce(sum(coalesce(bonus_minutes, 0)), 0)
  into v_inserted, v_inserted_present, v_inserted_absent, v_inserted_half_day, v_inserted_incomplete, v_inserted_ot, v_inserted_bonus
  from public.labour_attendance_submission_version_rows
  where submission_version_id = v_snapshot_id;
  if v_inserted <> v_rows or v_inserted_present <> v_present or v_inserted_absent <> v_absent or v_inserted_half_day <> v_half_day or v_inserted_incomplete <> v_incomplete or v_inserted_ot <> v_ot or v_inserted_bonus <> v_bonus then
    raise exception 'Attendance snapshot integrity check failed.';
  end if;

  update public.labour_attendance_periods
  set summary = jsonb_set(coalesce(v_period.summary, '{}'::jsonb), array['date_statuses', p_attendance_date::text], coalesce(v_period.summary->'date_statuses'->p_attendance_date::text, '{}'::jsonb) || jsonb_build_object('status','submitted','submitted_at',now(),'submitted_by',v_actor_id,'submitted_by_name',v_actor_name,'submitted_by_email',v_actor_email), true), submitted_by = v_actor_id, submitted_by_name = v_actor_name, submitted_by_email = v_actor_email, submitted_at = now(), updated_at = now()
  where id = p_period_id;
  return jsonb_build_object('submission_id', v_snapshot_id, 'submission_version', v_version, 'eligible_worker_count', v_rows, 'present_count', v_present, 'absent_count', v_absent, 'half_day_count', v_half_day, 'incomplete_count', v_incomplete, 'overtime_minutes_total', v_ot, 'bonus_minutes_total', v_bonus);
end;
$$;

revoke all on function public.create_labour_attendance_submission_snapshot(uuid, date, jsonb) from public, anon, authenticated;
grant execute on function public.create_labour_attendance_submission_snapshot(uuid, date, jsonb) to service_role;

commit;
