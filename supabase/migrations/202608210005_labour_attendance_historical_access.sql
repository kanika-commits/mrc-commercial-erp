begin;
create table if not exists public.attendance_historical_access (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  attendance_type text not null check (attendance_type in ('labour')),
  company_id uuid not null references public.companies(id),
  site_id uuid not null references public.sites(id),
  from_date date not null,
  to_date date not null,
  reason text not null check (length(btrim(reason)) > 0),
  opens_at timestamptz not null default now(),
  expires_at timestamptz,
  status text not null default 'open' check (status in ('open', 'closed')),
  opened_by uuid,
  opened_by_name text,
  opened_by_email text,
  opened_at timestamptz not null default now(),
  closed_by uuid,
  closed_by_name text,
  closed_by_email text,
  closed_at timestamptz,
  close_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attendance_historical_access_date_order check (from_date <= to_date),
  constraint attendance_historical_access_expiry_check check (expires_at is null or expires_at > opens_at),
  constraint attendance_historical_access_closed_fields_check check ((status = 'open' and closed_at is null and closed_by is null) or status = 'closed')
);
create index if not exists attendance_historical_access_scope_idx on public.attendance_historical_access (organization_id, company_id, site_id, attendance_type, from_date, to_date);
create index if not exists attendance_historical_access_status_idx on public.attendance_historical_access (status, opens_at, expires_at);
alter table public.attendance_historical_access enable row level security;
grant all on table public.attendance_historical_access to service_role;

create or replace function public.open_attendance_historical_access(
  p_organization_id uuid, p_attendance_type text, p_company_id uuid, p_site_id uuid,
  p_from_date date, p_to_date date, p_reason text, p_opens_at timestamptz,
  p_expires_at timestamptz, p_opened_by uuid, p_opened_by_name text, p_opened_by_email text
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
  perform pg_advisory_xact_lock(hashtextextended(format('%s:%s:%s:%s', p_organization_id, p_company_id, p_site_id, p_attendance_type), 0));
  if exists (select 1 from public.attendance_historical_access a where a.organization_id = p_organization_id and a.company_id = p_company_id and a.site_id = p_site_id and a.attendance_type = p_attendance_type and a.status = 'open' and a.closed_at is null and (a.expires_at is null or a.expires_at > v_now) and a.from_date <= p_to_date and a.to_date >= p_from_date) then
    raise exception 'An active historical attendance opening already overlaps this date range.' using errcode = '23P01';
  end if;
  insert into public.attendance_historical_access (organization_id, attendance_type, company_id, site_id, from_date, to_date, reason, opens_at, expires_at, status, opened_by, opened_by_name, opened_by_email, opened_at)
  values (p_organization_id, p_attendance_type, p_company_id, p_site_id, p_from_date, p_to_date, btrim(p_reason), p_opens_at, p_expires_at, 'open', p_opened_by, p_opened_by_name, p_opened_by_email, p_opens_at)
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.open_attendance_historical_access(uuid, text, uuid, uuid, date, date, text, timestamptz, timestamptz, uuid, text, text) from public, anon, authenticated;
grant execute on function public.open_attendance_historical_access(uuid, text, uuid, uuid, date, date, text, timestamptz, timestamptz, uuid, text, text) to service_role;
commit;
