-- Pilot-only Work Order revisions. Review/apply manually; this migration is not executed by this change.
create table if not exists public.work_order_pilot_revisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  predecessor_revision_id uuid references public.work_order_pilot_revisions(id),
  revision_number integer not null,
  applicable_date date not null,
  status text not null default 'draft' check (status in ('draft','submitted','approved','issued','superseded','rejected')),
  snapshot jsonb not null,
  snapshot_sha256 text not null,
  creation_request_id uuid not null,
  submitted_at timestamptz,
  approved_at timestamptz,
  issued_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  send_back_comment text,
  sent_back_at timestamptz,
  unique (work_order_id, revision_number),
  unique (organization_id, work_order_id, creation_request_id)
);
create index if not exists work_order_pilot_revisions_work_order_idx on public.work_order_pilot_revisions(work_order_id, revision_number);

create table if not exists public.work_order_pilot_revision_items (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references public.work_order_pilot_revisions(id) on delete cascade,
  source_item_id uuid,
  sort_order integer not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists work_order_pilot_revision_items_revision_idx on public.work_order_pilot_revision_items(revision_id, sort_order);

create table if not exists public.work_order_pilot_revision_artifacts (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null unique references public.work_order_pilot_revisions(id) on delete cascade,
  organization_id uuid not null,
  storage_bucket text not null default 'work-order-documents',
  storage_path text not null unique,
  sha256 text not null,
  byte_length bigint not null check (byte_length > 0),
  page_count integer not null check (page_count > 0),
  created_at timestamptz not null default now()
);

create unique index if not exists work_order_pilot_revision_issued_idx
  on public.work_order_pilot_revisions(work_order_id) where status = 'issued';
grant all on public.work_order_pilot_revisions to service_role;
grant all on public.work_order_pilot_revision_items to service_role;
grant all on public.work_order_pilot_revision_artifacts to service_role;

create or replace function public.issue_work_order_pilot_revision(p_revision_id uuid)
returns public.work_order_pilot_revisions
language plpgsql security definer set search_path = public
as $$
declare result public.work_order_pilot_revisions;
begin
  update public.work_order_pilot_revisions
     set status = 'superseded', updated_at = now()
   where work_order_id = (select work_order_id from public.work_order_pilot_revisions where id = p_revision_id)
     and status = 'issued' and id <> p_revision_id;
  update public.work_order_pilot_revisions
     set status = 'issued', issued_at = now(), updated_at = now()
   where id = p_revision_id and status = 'approved'
   returning * into result;
  if result.id is null then raise exception 'Only an approved revision can be issued'; end if;
  return result;
end;
$$;
revoke all on function public.issue_work_order_pilot_revision(uuid) from public, anon, authenticated;
grant execute on function public.issue_work_order_pilot_revision(uuid) to service_role;

create or replace function public.approve_work_order_pilot_revision(p_revision_id uuid)
returns public.work_order_pilot_revisions
language plpgsql security definer set search_path = public
as $$
declare result public.work_order_pilot_revisions;
begin
  update public.work_order_pilot_revisions
     set status = 'superseded', updated_at = now()
   where work_order_id = (select work_order_id from public.work_order_pilot_revisions where id = p_revision_id)
     and status = 'issued' and id <> p_revision_id;
  update public.work_order_pilot_revisions
     set status = 'issued', approved_at = now(), issued_at = now(), updated_at = now()
   where id = p_revision_id and status = 'submitted'
   returning * into result;
  if result.id is null then raise exception 'Only a submitted revision can be approved'; end if;
  return result;
end;
$$;
revoke all on function public.approve_work_order_pilot_revision(uuid) from public, anon, authenticated;
grant execute on function public.approve_work_order_pilot_revision(uuid) to service_role;
