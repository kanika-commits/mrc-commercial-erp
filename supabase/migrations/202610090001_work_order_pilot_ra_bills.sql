-- Pilot-only RA Bills. Prepare for review; do not apply automatically.
create table if not exists public.work_order_pilot_ra_bills (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, work_order_id uuid not null references public.work_orders(id),
  bill_number text not null, bill_date date not null, bill_period text, status text not null default 'draft' check (status in ('draft','submitted','approved','rejected')),
  work_order_snapshot jsonb not null, revision_snapshot jsonb not null, calculation_snapshot jsonb not null, security_cumulative numeric not null default 0,
  created_by uuid, creation_request_id uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), submitted_at timestamptz, approved_at timestamptz,
  unique (organization_id, bill_number),
  unique (organization_id, creation_request_id)
);
create table if not exists public.work_order_pilot_ra_bill_items (
  id uuid primary key default gen_random_uuid(), ra_bill_id uuid not null references public.work_order_pilot_ra_bills(id) on delete cascade,
  parent_serial text not null, description text not null, wo_qty numeric not null default 0, unit text, rate numeric not null default 0, bill_qty numeric not null default 0, cumulative_qty numeric not null default 0, current_amount numeric not null default 0, breakdowns jsonb not null default '[]'::jsonb, remarks text
);
alter table public.work_order_pilot_ra_bills add column if not exists reviewed_pdf_sha256 text;
alter table public.work_order_pilot_ra_bills add column if not exists reviewed_pdf_byte_length integer;
create index if not exists work_order_pilot_ra_bills_wo_idx on public.work_order_pilot_ra_bills(work_order_id, status, created_at desc);
grant all on public.work_order_pilot_ra_bills to service_role;
grant all on public.work_order_pilot_ra_bill_items to service_role;

create or replace function public.submit_work_order_pilot_ra_bill(p_id uuid)
returns public.work_order_pilot_ra_bills language plpgsql security definer set search_path = public as $$
declare result public.work_order_pilot_ra_bills;
begin
  update public.work_order_pilot_ra_bills set status='submitted', submitted_at=now(), updated_at=now() where id=p_id and status='draft' returning * into result;
  if result.id is null then raise exception 'Only a draft Pilot RA Bill can be submitted'; end if;
  return result;
end; $$;
revoke all on function public.submit_work_order_pilot_ra_bill(uuid) from public, anon, authenticated;
grant execute on function public.submit_work_order_pilot_ra_bill(uuid) to service_role;

create or replace function public.approve_work_order_pilot_ra_bill(p_id uuid)
returns public.work_order_pilot_ra_bills language plpgsql security definer set search_path = public as $$
declare result public.work_order_pilot_ra_bills;
begin
  update public.work_order_pilot_ra_bills set status='approved', approved_at=now(), updated_at=now() where id=p_id and status='submitted' returning * into result;
  if result.id is null then raise exception 'Only a submitted Pilot RA Bill can be approved'; end if;
  return result;
end; $$;
revoke all on function public.approve_work_order_pilot_ra_bill(uuid) from public, anon, authenticated;
grant execute on function public.approve_work_order_pilot_ra_bill(uuid) to service_role;
