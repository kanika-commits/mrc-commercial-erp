-- Scope Labour Attendance row identity to the authoritative attendance period.
-- This allows a worker to have same-date attendance in separate legitimate
-- company/site period contexts without mutating an unrelated submitted period.
begin;

do $$
declare
  v_count bigint;
  v_constraint_exists boolean;
begin
  select count(*)
    into v_count
    from public.labour_attendance
   where period_id is null;
  if v_count <> 0 then
    raise exception 'Cannot scope labour_attendance identity: % rows have NULL period_id.', v_count;
  end if;

  select count(*)
    into v_count
    from public.labour_attendance
   where company_id is null;
  if v_count <> 0 then
    raise exception 'Cannot scope labour_attendance identity: % rows have NULL company_id.', v_count;
  end if;

  select count(*)
    into v_count
    from public.labour_attendance
   where site_id is null;
  if v_count <> 0 then
    raise exception 'Cannot scope labour_attendance identity: % rows have NULL site_id.', v_count;
  end if;

  select count(*)
    into v_count
    from public.labour_attendance a
    left join public.labour_attendance_periods p on p.id = a.period_id
   where p.id is null
      or p.organization_id is distinct from a.organization_id
      or p.company_id is distinct from a.company_id
      or p.site_id is distinct from a.site_id;
  if v_count <> 0 then
    raise exception 'Cannot scope labour_attendance identity: % rows do not match their period organization/company/site context.', v_count;
  end if;

  select count(*)
    into v_count
    from (
      select period_id, labour_worker_id, attendance_date
        from public.labour_attendance
       group by period_id, labour_worker_id, attendance_date
      having count(*) > 1
    ) duplicate_keys;
  if v_count <> 0 then
    raise exception 'Cannot scope labour_attendance identity: % duplicate period/worker/date groups exist.', v_count;
  end if;

  select exists (
    select 1
      from pg_constraint
     where conrelid = 'public.labour_attendance'::regclass
       and conname = 'labour_attendance_labour_worker_id_attendance_date_key'
  ) into v_constraint_exists;

  if v_constraint_exists then
    alter table public.labour_attendance
      drop constraint labour_attendance_labour_worker_id_attendance_date_key;
  end if;

  alter table public.labour_attendance
    add constraint labour_attendance_period_worker_date_key
    unique (period_id, labour_worker_id, attendance_date);
end;
$$;

commit;
