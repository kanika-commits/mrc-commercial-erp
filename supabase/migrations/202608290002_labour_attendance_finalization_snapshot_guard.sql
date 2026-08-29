-- Atomically require exact-date submitted snapshots before new Standard finalization.
begin;

create or replace function public.finalize_labour_attendance_dates_atomic(
  p_period_ids uuid[],
  p_attendance_date date,
  p_actor jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period public.labour_attendance_periods%rowtype;
  v_snapshot public.labour_attendance_submission_versions%rowtype;
  v_snapshot_rows integer;
  v_snapshot_present integer;
  v_snapshot_absent integer;
  v_snapshot_half_day integer;
  v_snapshot_incomplete integer;
  v_snapshot_ot integer;
  v_snapshot_bonus integer;
  v_period_count integer;
begin
  if p_period_ids is null or cardinality(p_period_ids) = 0 or p_attendance_date is null then
    raise exception 'Attendance periods and date are required.';
  end if;

  select count(*) into v_period_count
  from public.labour_attendance_periods
  where id = any(p_period_ids);
  if v_period_count <> cardinality(p_period_ids) then
    raise exception 'One or more attendance periods were not found.';
  end if;

  for v_period in
    select * from public.labour_attendance_periods
    where id = any(p_period_ids)
    order by id
    for update
  loop
    if v_period.originating_attendance_system is distinct from 'standard' then
      raise exception 'This approval action is available only for Standard Attendance records.';
    end if;

    select * into v_snapshot
    from public.labour_attendance_submission_versions
    where period_id = v_period.id
      and organization_id = v_period.organization_id
      and company_id = v_period.company_id
      and site_id = v_period.site_id
      and contractor_profile_id is not distinct from v_period.contractor_profile_id
      and attendance_date = p_attendance_date
      and status = 'submitted'
    order by submission_version desc, submitted_at desc, id desc
    limit 1;
    if not found then
      raise exception 'Attendance cannot be finalized because its immutable submission snapshot is missing. Re-submit the attendance before approval.';
    end if;

    select count(*), count(*) filter (where derived_status = 'present'), count(*) filter (where derived_status = 'absent'), count(*) filter (where derived_status = 'half_day'), count(*) filter (where derived_status = 'incomplete'), coalesce(sum(coalesce(overtime_minutes, approved_overtime_minutes, 0)), 0), coalesce(sum(coalesce(bonus_minutes, 0)), 0)
    into v_snapshot_rows, v_snapshot_present, v_snapshot_absent, v_snapshot_half_day, v_snapshot_incomplete, v_snapshot_ot, v_snapshot_bonus
    from public.labour_attendance_submission_version_rows
    where submission_version_id = v_snapshot.id;
    if v_snapshot_rows = 0
      or v_snapshot_rows <> v_snapshot.eligible_worker_count
      or v_snapshot_present <> v_snapshot.present_count
      or v_snapshot_absent <> v_snapshot.absent_count
      or v_snapshot_half_day <> v_snapshot.half_day_count
      or v_snapshot_incomplete <> v_snapshot.incomplete_count
      or v_snapshot_ot <> v_snapshot.overtime_minutes_total
      or v_snapshot_bonus <> v_snapshot.bonus_minutes_total then
      raise exception 'Attendance immutable submission snapshot is invalid and cannot be finalized.';
    end if;

    if v_period.summary->'date_statuses'->p_attendance_date::text->>'status' is not null
      and v_period.summary->'date_statuses'->p_attendance_date::text->>'status' <> 'submitted' then
      raise exception 'Attendance for % is not eligible for finalization.', p_attendance_date;
    end if;
  end loop;

  for v_period in
    select * from public.labour_attendance_periods
    where id = any(p_period_ids)
    order by id
  loop
    update public.labour_attendance_periods
    set summary = jsonb_set(
      coalesce(v_period.summary, '{}'::jsonb),
      array['date_statuses', p_attendance_date::text],
      coalesce(v_period.summary->'date_statuses'->p_attendance_date::text, '{}'::jsonb)
        || jsonb_build_object('status', 'finalized', 'finalized_at', now(), 'finalized_by', nullif(p_actor->>'user_id', '')::uuid, 'finalized_by_name', nullif(p_actor->>'name', ''), 'finalized_by_email', nullif(p_actor->>'email', '')),
      true
    ),
    updated_at = now()
    where id = v_period.id;
  end loop;

  return jsonb_build_object('finalized', true, 'attendance_date', p_attendance_date, 'period_count', cardinality(p_period_ids));
end;
$$;

create or replace function public.finalize_labour_attendance_period_atomic(
  p_period_id uuid,
  p_actor jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period public.labour_attendance_periods%rowtype;
  v_date text;
  v_status text;
begin
  select * into v_period
  from public.labour_attendance_periods
  where id = p_period_id
  for update;
  if not found then raise exception 'Attendance period not found.'; end if;
  if v_period.originating_attendance_system is distinct from 'standard' then
    raise exception 'This approval action is available only for Standard Attendance records.';
  end if;
  if v_period.status <> 'submitted' then
    raise exception 'Submit the attendance period before finalizing.';
  end if;

  for v_date, v_status in
    select key, value->>'status'
    from jsonb_each(coalesce(v_period.summary->'date_statuses', '{}'::jsonb))
    order by key
  loop
    if v_status is null or v_status not in ('finalized', 'cancelled', 'draft') then
      raise exception 'Attendance period cannot be closed while attendance date % is unresolved.', v_date;
    end if;
  end loop;

  update public.labour_attendance_periods
  set status = 'finalized', finalized_at = now(), updated_at = now(),
      finalized_by = nullif(p_actor->>'user_id', '')::uuid,
      finalized_by_name = nullif(p_actor->>'name', ''),
      finalized_by_email = nullif(p_actor->>'email', '')
  where id = p_period_id;
  return jsonb_build_object('finalized', true, 'period_id', p_period_id, 'closure_only', true);
end;
$$;

revoke all on function public.finalize_labour_attendance_dates_atomic(uuid[], date, jsonb) from public, anon, authenticated;
revoke all on function public.finalize_labour_attendance_period_atomic(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.finalize_labour_attendance_dates_atomic(uuid[], date, jsonb) to service_role;
grant execute on function public.finalize_labour_attendance_period_atomic(uuid, jsonb) to service_role;

commit;
