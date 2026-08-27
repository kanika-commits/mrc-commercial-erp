-- Conditionally restore date-specific metadata when superseding an invalid snapshot.
begin;

create or replace function public.supersede_invalid_labour_attendance_snapshot(
  p_snapshot_version_id uuid,
  p_reason text,
  p_actor jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target public.labour_attendance_submission_versions%rowtype;
  v_previous public.labour_attendance_submission_versions%rowtype;
  v_period public.labour_attendance_periods%rowtype;
  v_actor_id uuid := nullif(p_actor->>'user_id', '')::uuid;
  v_target_rows integer;
  v_target_present integer;
  v_target_absent integer;
  v_target_half_day integer;
  v_target_incomplete integer;
  v_target_ot integer;
  v_target_bonus integer;
  v_previous_rows integer;
  v_previous_present integer;
  v_previous_absent integer;
  v_previous_half_day integer;
  v_previous_incomplete integer;
  v_previous_ot integer;
  v_previous_bonus integer;
  v_date_entry jsonb;
  v_date_status text;
  v_repair_metadata boolean := false;
  v_event_id uuid;
begin
  if v_actor_id is null then raise exception 'Authenticated actor is required.'; end if;
  if nullif(trim(p_reason), '') is null then raise exception 'A repair reason is required.'; end if;

  select * into v_target
  from public.labour_attendance_submission_versions
  where id = p_snapshot_version_id
  for update;
  if not found then raise exception 'Attendance snapshot version not found.'; end if;
  if v_target.status <> 'submitted' then raise exception 'Only submitted snapshots can be superseded.'; end if;
  select * into v_period
  from public.labour_attendance_periods
  where id = v_target.period_id
  for update;
  if not found then raise exception 'Attendance period not found.'; end if;

  select count(*), count(*) filter (where derived_status = 'present'),
    count(*) filter (where derived_status = 'absent'), count(*) filter (where derived_status = 'half_day'),
    count(*) filter (where derived_status = 'incomplete'),
    coalesce(sum(coalesce(overtime_minutes, 0)), 0),
    coalesce(sum(coalesce(bonus_minutes, 0)), 0)
  into v_target_rows, v_target_present, v_target_absent, v_target_half_day,
    v_target_incomplete, v_target_ot, v_target_bonus
  from public.labour_attendance_submission_version_rows
  where submission_version_id = v_target.id;

  if v_target_rows > 0
    and v_target.eligible_worker_count = v_target_rows
    and v_target.present_count = v_target_present
    and v_target.absent_count = v_target_absent
    and v_target.half_day_count = v_target_half_day
    and v_target.incomplete_count = v_target_incomplete
    and v_target.overtime_minutes_total = v_target_ot
    and v_target.bonus_minutes_total = v_target_bonus then
    raise exception 'Attendance snapshot passes integrity checks and cannot be superseded.';
  end if;

  v_previous := null;
  for v_previous in
    select *
    from public.labour_attendance_submission_versions
    where organization_id = v_target.organization_id
      and company_id = v_target.company_id
      and site_id = v_target.site_id
      and period_id = v_target.period_id
      and attendance_date = v_target.attendance_date
      and status = 'submitted'
      and submission_version < v_target.submission_version
      and contractor_profile_id is not distinct from v_target.contractor_profile_id
    order by submission_version desc, submitted_at desc, id desc
  loop
    select count(*), count(*) filter (where derived_status = 'present'),
      count(*) filter (where derived_status = 'absent'), count(*) filter (where derived_status = 'half_day'),
      count(*) filter (where derived_status = 'incomplete'),
      coalesce(sum(coalesce(overtime_minutes, 0)), 0),
      coalesce(sum(coalesce(bonus_minutes, 0)), 0)
    into v_previous_rows, v_previous_present, v_previous_absent, v_previous_half_day,
      v_previous_incomplete, v_previous_ot, v_previous_bonus
    from public.labour_attendance_submission_version_rows
    where submission_version_id = v_previous.id;

    if v_previous_rows > 0
      and v_previous.eligible_worker_count = v_previous_rows
      and v_previous.present_count = v_previous_present
      and v_previous.absent_count = v_previous_absent
      and v_previous.half_day_count = v_previous_half_day
      and v_previous.incomplete_count = v_previous_incomplete
      and v_previous.overtime_minutes_total = v_previous_ot
      and v_previous.bonus_minutes_total = v_previous_bonus then
      exit;
    end if;
    v_previous := null;
  end loop;
  if v_previous.id is null then raise exception 'No earlier valid submitted snapshot exists for this exact attendance scope.'; end if;

  v_date_entry := v_period.summary->'date_statuses'->v_target.attendance_date::text;
  v_date_status := v_date_entry->>'status';
  if v_date_entry is not null
    and v_date_status = 'submitted'
    and nullif(v_date_entry->>'submitted_at', '')::timestamptz = v_target.submitted_at
    and ((v_date_entry->>'submitted_by') is null and v_target.submitted_by is null
      or (v_date_entry->>'submitted_by') is not null and v_target.submitted_by is not null
        and (v_date_entry->>'submitted_by')::uuid = v_target.submitted_by) then
    v_repair_metadata := true;
  end if;

  update public.labour_attendance_submission_versions
  set status = 'superseded'
  where id = v_target.id and status = 'submitted';

  if v_repair_metadata then
    update public.labour_attendance_periods
    set summary = jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(v_period.summary, array['date_statuses', v_target.attendance_date::text, 'submitted_at'], coalesce(to_jsonb(v_previous.submitted_at), 'null'::jsonb), true),
          array['date_statuses', v_target.attendance_date::text, 'submitted_by'], coalesce(to_jsonb(v_previous.submitted_by), 'null'::jsonb), true),
        array['date_statuses', v_target.attendance_date::text, 'submitted_by_name'], coalesce(to_jsonb(v_previous.submitted_by_name), 'null'::jsonb), true),
      array['date_statuses', v_target.attendance_date::text, 'submitted_by_email'], coalesce(to_jsonb(v_previous.submitted_by_email), 'null'::jsonb), true),
      updated_at = now()
    where id = v_target.period_id;
  end if;

  insert into public.labour_attendance_snapshot_repair_events (
    snapshot_version_id, period_id, attendance_date, previous_status, new_status,
    reason, resulting_authoritative_snapshot_id, repaired_by, repaired_by_name, repaired_by_email
  ) values (
    v_target.id, v_target.period_id, v_target.attendance_date, v_target.status, 'superseded',
    trim(p_reason), v_previous.id, v_actor_id,
    nullif(p_actor->>'name', ''), nullif(p_actor->>'email', '')
  ) returning id into v_event_id;

  return jsonb_build_object(
    'repair_event_id', v_event_id,
    'superseded_snapshot_id', v_target.id,
    'resulting_authoritative_snapshot_id', v_previous.id,
    'canonical_metadata_repaired', v_repair_metadata
  );
end;
$$;

revoke all on function public.supersede_invalid_labour_attendance_snapshot(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.supersede_invalid_labour_attendance_snapshot(uuid, text, jsonb) to service_role;

commit;
