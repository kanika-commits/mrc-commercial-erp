-- Pilot-only over-quantity policy and exception audit. Prepare, do not apply automatically.
create table if not exists public.pilot_ra_bill_over_quantity_policies (
  organization_id uuid primary key,
  allowance_percent numeric not null default 0 check (allowance_percent >= 0),
  configured_by uuid,
  configured_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.work_order_pilot_ra_bills add column if not exists over_quantity_allowance_percent numeric not null default 0 check (over_quantity_allowance_percent >= 0);
alter table public.work_order_pilot_ra_bills add column if not exists over_quantity_exception_status text not null default 'not_required' check (over_quantity_exception_status in ('not_required','pending','approved','rejected'));
alter table public.work_order_pilot_ra_bills add column if not exists over_quantity_exception_decided_by uuid;
alter table public.work_order_pilot_ra_bills add column if not exists over_quantity_exception_decided_at timestamptz;
alter table public.work_order_pilot_ra_bills add column if not exists over_quantity_exception_decision text;
alter table public.work_order_pilot_ra_bills add column if not exists over_quantity_exception_snapshot jsonb;
grant all on public.pilot_ra_bill_over_quantity_policies to service_role;

create table if not exists public.work_order_pilot_ra_bill_over_quantity_audit (
  id uuid primary key default gen_random_uuid(),
  ra_bill_id uuid not null references public.work_order_pilot_ra_bills(id) on delete cascade,
  organization_id uuid not null,
  decision text not null check (decision in ('approved','rejected')),
  actor_id uuid not null,
  reason text,
  created_at timestamptz not null default now(),
  unique (ra_bill_id, decision)
);
grant all on public.work_order_pilot_ra_bill_over_quantity_audit to service_role;

create unique index if not exists user_notifications_pilot_ra_bill_over_quantity_uidx
  on public.user_notifications(organization_id, recipient_user_id, notification_type, related_entity_type, related_entity_id)
  where notification_type = 'pilot_ra_bill_over_quantity_exception';

create or replace function public.decide_work_order_pilot_ra_bill_over_quantity(p_id uuid, p_actor uuid, p_decision text, p_reason text default null)
returns public.work_order_pilot_ra_bills language plpgsql security definer set search_path=public as $$
declare result public.work_order_pilot_ra_bills;
begin
  if p_decision not in ('approved','rejected') then raise exception 'Invalid over-quantity exception decision'; end if;
  update public.work_order_pilot_ra_bills
    set over_quantity_exception_status=p_decision, over_quantity_exception_decided_by=p_actor,
        over_quantity_exception_decided_at=now(), over_quantity_exception_decision=coalesce(nullif(trim(p_reason),''), p_decision), updated_at=now()
    where id=p_id and status='submitted' and over_quantity_exception_status='pending'
    returning * into result;
  if result.id is null then raise exception 'Only a submitted Pilot RA Bill with a pending over-quantity exception can be decided'; end if;
  insert into public.work_order_pilot_ra_bill_over_quantity_audit(ra_bill_id,organization_id,decision,actor_id,reason)
    values(p_id,result.organization_id,p_decision,p_actor,nullif(trim(p_reason),''))
    on conflict (ra_bill_id, decision) do nothing;
  return result;
end; $$;
revoke all on function public.decide_work_order_pilot_ra_bill_over_quantity(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.decide_work_order_pilot_ra_bill_over_quantity(uuid,uuid,text,text) to service_role;

create or replace function public.approve_work_order_pilot_ra_bill_cycle(p_id uuid, p_actor uuid)
returns public.work_order_pilot_ra_bills language plpgsql security definer set search_path=public as $$
declare result public.work_order_pilot_ra_bills; c public.work_order_pilot_ra_bill_review_cycles;
begin
  if exists (select 1 from public.work_order_pilot_ra_bills where id=p_id and over_quantity_exception_status='pending') then
    raise exception 'Super Admin over-quantity exception approval is required before ordinary Pilot RA Bill approval';
  end if;
  select * into c from public.work_order_pilot_ra_bill_review_cycles where ra_bill_id=p_id and status='submitted' order by cycle_number desc limit 1;
  if c.id is null then raise exception 'Only a submitted Pilot RA Bill can be approved'; end if;
  update public.work_order_pilot_ra_bill_review_cycles set status='approved', decided_by=p_actor, decided_at=now() where id=c.id;
  update public.work_order_pilot_ra_bills set status='approved', approved_at=now(), updated_at=now() where id=p_id returning * into result;
  insert into public.work_order_pilot_ra_bill_review_audit(ra_bill_id,cycle_id,organization_id,action,actor_id) values(p_id,c.id,c.organization_id,'approved',p_actor);
  return result;
end; $$;
