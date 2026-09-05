-- Repair missing Standard Labour Attendance per-date submitted metadata from
-- immutable submission snapshots. This is intentionally narrow: it only fills
-- absent summary.date_statuses[attendance_date] objects and does not modify
-- attendance rows, submission snapshots, snapshot rows, approvals, or period
-- workflow status.
begin;

do $$
declare
  v_raw_submission_versions integer;
  v_unique_period_dates integer;
  v_target_count integer;
  v_finalized_protected_count integer;
  v_reopened_protected_count integer;
  v_multiple_version_extra_count integer;
  v_affected_period_count integer;
  v_updated_period_count integer;
  v_multi_date_period_count integer;
  v_invalid_target_count integer;
  v_invalid_snapshot_count integer;
  v_post_missing_count integer;
  v_post_downgraded_finalized_count integer;
begin
  select count(*)
    into v_raw_submission_versions
    from public.labour_attendance_submission_versions
   where status = 'submitted';

  create temporary table pg_temp.labour_attendance_historical_date_status_targets on commit drop as
  with latest_submissions as (
    select
      sv.*,
      row_number() over (
        partition by sv.period_id, sv.attendance_date
        order by sv.submission_version desc, sv.submitted_at desc, sv.id desc
      ) as rn,
      count(*) over (partition by sv.period_id, sv.attendance_date) as version_count
    from public.labour_attendance_submission_versions sv
    where sv.status = 'submitted'
  ),
  latest_by_date as (
    select *
    from latest_submissions
    where rn = 1
  )
  select
    latest_by_date.id as submission_version_id,
    latest_by_date.organization_id,
    latest_by_date.company_id,
    latest_by_date.site_id,
    latest_by_date.contractor_profile_id,
    latest_by_date.period_id,
    latest_by_date.attendance_date,
    latest_by_date.submission_version,
    latest_by_date.submitted_by,
    latest_by_date.submitted_by_name,
    latest_by_date.submitted_by_email,
    latest_by_date.submitted_at,
    latest_by_date.eligible_worker_count,
    latest_by_date.present_count,
    latest_by_date.absent_count,
    latest_by_date.half_day_count,
    latest_by_date.incomplete_count,
    latest_by_date.overtime_minutes_total,
    latest_by_date.bonus_minutes_total,
    latest_by_date.version_count,
    p.status as period_status,
    p.summary as existing_summary,
    p.summary->'date_statuses'->latest_by_date.attendance_date::text as existing_date_status
  from latest_by_date
  join public.labour_attendance_periods p on p.id = latest_by_date.period_id
  where p.originating_attendance_system = 'standard'
    and p.summary->'date_statuses'->latest_by_date.attendance_date::text is null
    and p.status = 'draft';

  select count(distinct (sv.period_id, sv.attendance_date))
    into v_unique_period_dates
    from public.labour_attendance_submission_versions sv
   where sv.status = 'submitted';

  select count(*)
    into v_finalized_protected_count
    from (
      select distinct on (sv.period_id, sv.attendance_date)
        p.summary->'date_statuses'->sv.attendance_date::text->>'status' as date_status
      from public.labour_attendance_submission_versions sv
      join public.labour_attendance_periods p on p.id = sv.period_id
      where sv.status = 'submitted'
      order by sv.period_id, sv.attendance_date, sv.submission_version desc, sv.submitted_at desc, sv.id desc
    ) latest
    where latest.date_status = 'finalized';

  select count(*)
    into v_reopened_protected_count
    from (
      select distinct on (sv.period_id, sv.attendance_date)
        p.summary->'date_statuses'->sv.attendance_date::text->>'status' as date_status
      from public.labour_attendance_submission_versions sv
      join public.labour_attendance_periods p on p.id = sv.period_id
      where sv.status = 'submitted'
      order by sv.period_id, sv.attendance_date, sv.submission_version desc, sv.submitted_at desc, sv.id desc
    ) latest
    where latest.date_status = 'reopened';

  select v_raw_submission_versions - v_unique_period_dates
    into v_multiple_version_extra_count;

  select count(*)
    into v_target_count
    from pg_temp.labour_attendance_historical_date_status_targets;

  select count(distinct period_id)
    into v_affected_period_count
    from pg_temp.labour_attendance_historical_date_status_targets;

  select count(*)
    into v_multi_date_period_count
    from (
      select period_id
      from pg_temp.labour_attendance_historical_date_status_targets
      group by period_id
      having count(*) >= 3
    ) multi_date_periods;

  if v_raw_submission_versions <> 75 then
    raise exception 'Unexpected submitted submission-version count: expected 75, found %.', v_raw_submission_versions;
  end if;
  if v_unique_period_dates <> 65 then
    raise exception 'Unexpected unique period/date count: expected 65, found %.', v_unique_period_dates;
  end if;
  if v_target_count <> 34 then
    raise exception 'Unexpected repair target count: expected 34, found %.', v_target_count;
  end if;
  if v_multi_date_period_count = 0 then
    raise exception 'Historical date-status repair target set does not exercise a multi-date period.';
  end if;
  if v_finalized_protected_count <> 31 then
    raise exception 'Unexpected finalized protected count: expected 31, found %.', v_finalized_protected_count;
  end if;
  if v_reopened_protected_count <> 0 then
    raise exception 'Unexpected reopened protected count: expected 0, found %.', v_reopened_protected_count;
  end if;
  if v_multiple_version_extra_count <> 10 then
    raise exception 'Unexpected duplicate submission-version count: expected 10, found %.', v_multiple_version_extra_count;
  end if;

  select count(*)
    into v_invalid_target_count
    from pg_temp.labour_attendance_historical_date_status_targets t
    join public.labour_attendance_periods p on p.id = t.period_id
    where p.summary->'date_statuses'->t.attendance_date::text is not null
       or p.status <> 'draft'
       or p.originating_attendance_system is distinct from 'standard'
       or t.submitted_at is null
       or t.submitted_by is null
       or t.incomplete_count <> 0;

  if v_invalid_target_count <> 0 then
    raise exception 'Historical date-status repair target set is no longer safe: % invalid targets.', v_invalid_target_count;
  end if;

  select count(*)
    into v_invalid_snapshot_count
    from pg_temp.labour_attendance_historical_date_status_targets t
    left join lateral (
      select
        count(*) as row_count,
        count(*) filter (where derived_status = 'present') as present_count,
        count(*) filter (where derived_status = 'absent') as absent_count,
        count(*) filter (where derived_status = 'half_day') as half_day_count,
        count(*) filter (where derived_status = 'incomplete') as incomplete_count,
        coalesce(sum(coalesce(approved_overtime_minutes, overtime_minutes, 0)), 0) as overtime_minutes_total,
        coalesce(sum(coalesce(bonus_minutes, 0)), 0) as bonus_minutes_total
      from public.labour_attendance_submission_version_rows r
      where r.submission_version_id = t.submission_version_id
    ) r on true
    where r.row_count <> t.eligible_worker_count
       or r.present_count <> t.present_count
       or r.absent_count <> t.absent_count
       or r.half_day_count <> t.half_day_count
       or r.incomplete_count <> t.incomplete_count
       or r.overtime_minutes_total <> t.overtime_minutes_total
       or r.bonus_minutes_total <> t.bonus_minutes_total;

  if v_invalid_snapshot_count <> 0 then
    raise exception 'Historical date-status repair blocked: % target snapshots failed integrity checks.', v_invalid_snapshot_count;
  end if;

  create temporary table pg_temp.labour_attendance_historical_date_status_period_patches on commit drop as
  select
    period_id,
    jsonb_object_agg(
      attendance_date::text,
      jsonb_build_object(
        'status', 'submitted',
        'submitted_at', submitted_at,
        'submitted_by', submitted_by,
        'submitted_by_name', submitted_by_name,
        'submitted_by_email', submitted_by_email
      )
      order by attendance_date
    ) as date_status_patch
  from pg_temp.labour_attendance_historical_date_status_targets
  group by period_id;

  update public.labour_attendance_periods p
     set summary =
       coalesce(p.summary, '{}'::jsonb)
       || jsonb_build_object(
         'date_statuses',
         coalesce(p.summary->'date_statuses', '{}'::jsonb)
         || pp.date_status_patch
       ),
       updated_at = now()
    from pg_temp.labour_attendance_historical_date_status_period_patches pp
   where p.id = pp.period_id
     and p.status = 'draft'
     and p.originating_attendance_system = 'standard';

  get diagnostics v_updated_period_count = row_count;
  if v_updated_period_count <> v_affected_period_count then
    raise exception 'Historical date-status repair updated % period rows, expected %.',
      v_updated_period_count, v_affected_period_count;
  end if;

  select count(*)
    into v_post_missing_count
    from pg_temp.labour_attendance_historical_date_status_targets t
    join public.labour_attendance_periods p on p.id = t.period_id
    where p.summary->'date_statuses'->t.attendance_date::text->>'status' <> 'submitted'
       or (p.summary->'date_statuses'->t.attendance_date::text->>'submitted_at')::timestamptz is distinct from t.submitted_at
       or (p.summary->'date_statuses'->t.attendance_date::text->>'submitted_by')::uuid is distinct from t.submitted_by
       or p.summary->'date_statuses'->t.attendance_date::text->>'submitted_by_name' is distinct from t.submitted_by_name
       or p.summary->'date_statuses'->t.attendance_date::text->>'submitted_by_email' is distinct from t.submitted_by_email;

  if v_post_missing_count <> 0 then
    raise exception 'Historical date-status repair post-check failed for % targets.', v_post_missing_count;
  end if;

  select count(*)
    into v_post_downgraded_finalized_count
    from (
      select distinct on (sv.period_id, sv.attendance_date)
        p.summary->'date_statuses'->sv.attendance_date::text->>'status' as date_status
      from public.labour_attendance_submission_versions sv
      join public.labour_attendance_periods p on p.id = sv.period_id
      where sv.status = 'submitted'
      order by sv.period_id, sv.attendance_date, sv.submission_version desc, sv.submitted_at desc, sv.id desc
    ) latest
    where latest.date_status = 'finalized';

  if v_post_downgraded_finalized_count <> v_finalized_protected_count then
    raise exception 'Historical date-status repair would alter finalized protections: before %, after %.',
      v_finalized_protected_count, v_post_downgraded_finalized_count;
  end if;
end;
$$;

commit;
