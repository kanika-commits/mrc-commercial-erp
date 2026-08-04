do $$
begin
  if exists (
    select 1
    from public.labour_workers
    where aadhaar_number is not null
      and btrim(aadhaar_number) <> ''
      and (
        aadhaar_number ~ '[^0-9[:space:]-]'
        or length(regexp_replace(aadhaar_number, '[^0-9]', '', 'g')) <> 12
      )
  ) then
    raise exception 'Cannot add Labour Aadhaar constraints: invalid Aadhaar values exist.';
  end if;

  if exists (
    select 1
    from (
      select organization_id, regexp_replace(aadhaar_number, '[^0-9]', '', 'g') as aadhaar_digits, count(*) as duplicate_count
      from public.labour_workers
      where aadhaar_number is not null
        and btrim(aadhaar_number) <> ''
      group by organization_id, regexp_replace(aadhaar_number, '[^0-9]', '', 'g')
      having count(*) > 1
    ) duplicates
  ) then
    raise exception 'Cannot add Labour Aadhaar unique index: duplicate normalized Aadhaar values exist.';
  end if;
end $$;

update public.labour_workers
set aadhaar_number =
  substring(regexp_replace(aadhaar_number, '[^0-9]', '', 'g') from 1 for 4)
  || '-' ||
  substring(regexp_replace(aadhaar_number, '[^0-9]', '', 'g') from 5 for 4)
  || '-' ||
  substring(regexp_replace(aadhaar_number, '[^0-9]', '', 'g') from 9 for 4)
where aadhaar_number is not null
  and btrim(aadhaar_number) <> ''
  and aadhaar_number <> (
    substring(regexp_replace(aadhaar_number, '[^0-9]', '', 'g') from 1 for 4)
    || '-' ||
    substring(regexp_replace(aadhaar_number, '[^0-9]', '', 'g') from 5 for 4)
    || '-' ||
    substring(regexp_replace(aadhaar_number, '[^0-9]', '', 'g') from 9 for 4)
  );

drop index if exists public.labour_workers_aadhaar_unique_idx;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'labour_workers_aadhaar_format_check'
      and conrelid = 'public.labour_workers'::regclass
  ) then
    alter table public.labour_workers
      add constraint labour_workers_aadhaar_format_check
      check (
        aadhaar_number is null
        or btrim(aadhaar_number) = ''
        or aadhaar_number ~ '^[0-9]{4}-[0-9]{4}-[0-9]{4}$'
      );
  end if;
end $$;

create unique index if not exists labour_workers_aadhaar_unique_idx
  on public.labour_workers (
    organization_id,
    regexp_replace(aadhaar_number, '[^0-9]', '', 'g')
  )
  where aadhaar_number is not null
    and btrim(aadhaar_number) <> '';

create or replace function public.find_labour_worker_by_aadhaar(
  p_organization_id uuid,
  p_aadhaar_digits text,
  p_exclude_worker_id uuid default null
)
returns table(
  id uuid,
  labour_code text,
  worker_name text,
  aadhaar_number text,
  status text
)
language sql
stable
security definer
set search_path = public
as $$
  select w.id, w.labour_code, w.worker_name, w.aadhaar_number, w.status
  from public.labour_workers w
  where w.organization_id = p_organization_id
    and w.aadhaar_number is not null
    and btrim(w.aadhaar_number) <> ''
    and regexp_replace(w.aadhaar_number, '[^0-9]', '', 'g') = p_aadhaar_digits
    and (p_exclude_worker_id is null or w.id <> p_exclude_worker_id)
  order by w.created_at asc
  limit 1;
$$;

grant execute on function public.find_labour_worker_by_aadhaar(uuid, text, uuid) to authenticated;
grant execute on function public.find_labour_worker_by_aadhaar(uuid, text, uuid) to service_role;
