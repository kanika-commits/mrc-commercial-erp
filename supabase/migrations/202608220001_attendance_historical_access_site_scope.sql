begin;
alter table public.attendance_historical_access alter column company_id drop not null;
drop index if exists public.attendance_historical_access_scope_idx;
create index if not exists attendance_historical_access_site_scope_idx on public.attendance_historical_access (organization_id, site_id, attendance_type, from_date, to_date);
create function public.open_attendance_historical_access(
  p_organization_id uuid, p_attendance_type text, p_site_id uuid, p_from_date date, p_to_date date,
  p_reason text, p_opens_at timestamptz, p_expires_at timestamptz, p_opened_by uuid, p_opened_by_name text, p_opened_by_email text
)
returns public.attendance_historical_access
language plpgsql security definer set search_path = public
as $$
declare v_row public.attendance_historical_access; v_now timestamptz := now();
begin
  if p_attendance_type <> 'labour' then raise exception 'Unsupported attendance type.' using errcode = '22023'; end if;
  if p_from_date is null or p_to_date is null or p_from_date > p_to_date then raise exception 'From date must be on or before To date.' using errcode = '22023'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason is required.' using errcode = '22023'; end if;
  if p_opens_at is null then raise exception 'Opening time is required.' using errcode = '22023'; end if;
  if p_expires_at is not null and p_expires_at <= p_opens_at then raise exception 'Expiry must be after opening time.' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(format('%s:%s:%s', p_organization_id, p_site_id, p_attendance_type), 0));
  if exists (select 1 from public.attendance_historical_access a where a.organization_id = p_organization_id and a.site_id = p_site_id and a.attendance_type = p_attendance_type and a.status = 'open' and a.closed_at is null and (a.expires_at is null or a.expires_at > v_now) and a.from_date <= p_to_date and a.to_date >= p_from_date) then
    raise exception 'An active historical attendance opening already overlaps this date range.' using errcode = '23P01';
  end if;
  insert into public.attendance_historical_access (organization_id, attendance_type, company_id, site_id, from_date, to_date, reason, opens_at, expires_at, status, opened_by, opened_by_name, opened_by_email, opened_at)
  values (p_organization_id, p_attendance_type, null, p_site_id, p_from_date, p_to_date, btrim(p_reason), p_opens_at, p_expires_at, 'open', p_opened_by, p_opened_by_name, p_opened_by_email, p_opens_at)
  returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.open_attendance_historical_access(uuid, text, uuid, date, date, text, timestamptz, timestamptz, uuid, text, text) from public, anon, authenticated;
grant execute on function public.open_attendance_historical_access(uuid, text, uuid, date, date, text, timestamptz, timestamptz, uuid, text, text) to service_role;
commit;
