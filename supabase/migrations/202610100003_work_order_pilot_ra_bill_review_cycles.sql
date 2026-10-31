-- Forward-only Pilot review-cycle history. Do not apply automatically.
create table if not exists public.work_order_pilot_ra_bill_review_cycles (
  id uuid primary key default gen_random_uuid(),
  ra_bill_id uuid not null references public.work_order_pilot_ra_bills(id) on delete cascade,
  organization_id uuid not null,
  cycle_number integer not null,
  status text not null check (status in ('submitted','approved','sent_back')),
  reviewed_pdf_sha256 text not null,
  reviewed_pdf_byte_length integer not null,
  pdf_bytes bytea not null,
  attachment_manifest jsonb not null default '[]'::jsonb,
  attachment_manifest_sha256 text,
  submitted_by uuid,
  submitted_at timestamptz not null default now(),
  decided_by uuid,
  decided_at timestamptz,
  send_back_reason text,
  unique (ra_bill_id, cycle_number)
);
create table if not exists public.work_order_pilot_ra_bill_review_audit (
  id uuid primary key default gen_random_uuid(),
  ra_bill_id uuid not null references public.work_order_pilot_ra_bills(id) on delete cascade,
  cycle_id uuid not null references public.work_order_pilot_ra_bill_review_cycles(id) on delete cascade,
  organization_id uuid not null,
  action text not null check (action in ('submitted','approved','sent_back')),
  actor_id uuid,
  reason text,
  created_at timestamptz not null default now()
);
grant all on public.work_order_pilot_ra_bill_review_cycles to service_role;
grant all on public.work_order_pilot_ra_bill_review_audit to service_role;

create or replace function public.send_back_work_order_pilot_ra_bill(p_id uuid, p_reason text, p_actor uuid)
returns public.work_order_pilot_ra_bills language plpgsql security definer set search_path=public as $$
declare result public.work_order_pilot_ra_bills; c public.work_order_pilot_ra_bill_review_cycles;
begin
  if coalesce(trim(p_reason),'') = '' then raise exception 'A send-back reason is required'; end if;
  select * into c from public.work_order_pilot_ra_bill_review_cycles where ra_bill_id=p_id and status='submitted' order by cycle_number desc limit 1;
  if c.id is null then raise exception 'Only a submitted Pilot RA Bill can be sent back'; end if;
  update public.work_order_pilot_ra_bill_review_cycles set status='sent_back', decided_by=p_actor, decided_at=now(), send_back_reason=trim(p_reason) where id=c.id;
  update public.work_order_pilot_ra_bills set status='sent_back', updated_at=now() where id=p_id returning * into result;
  insert into public.work_order_pilot_ra_bill_review_audit(ra_bill_id,cycle_id,organization_id,action,actor_id,reason) values(p_id,c.id,c.organization_id,'sent_back',p_actor,trim(p_reason));
  return result;
end; $$;
revoke all on function public.send_back_work_order_pilot_ra_bill(uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.send_back_work_order_pilot_ra_bill(uuid,text,uuid) to service_role;

create or replace function public.approve_work_order_pilot_ra_bill_cycle(p_id uuid, p_actor uuid)
returns public.work_order_pilot_ra_bills language plpgsql security definer set search_path=public as $$
declare result public.work_order_pilot_ra_bills; c public.work_order_pilot_ra_bill_review_cycles;
begin
  select * into c from public.work_order_pilot_ra_bill_review_cycles where ra_bill_id=p_id and status='submitted' order by cycle_number desc limit 1;
  if c.id is null then raise exception 'Only a submitted Pilot RA Bill can be approved'; end if;
  update public.work_order_pilot_ra_bill_review_cycles set status='approved', decided_by=p_actor, decided_at=now() where id=c.id;
  update public.work_order_pilot_ra_bills set status='approved', approved_at=now(), updated_at=now() where id=p_id returning * into result;
  insert into public.work_order_pilot_ra_bill_review_audit(ra_bill_id,cycle_id,organization_id,action,actor_id) values(p_id,c.id,c.organization_id,'approved',p_actor);
  return result;
end; $$;
revoke all on function public.approve_work_order_pilot_ra_bill_cycle(uuid,uuid) from public, anon, authenticated;
grant execute on function public.approve_work_order_pilot_ra_bill_cycle(uuid,uuid) to service_role;

-- Submission cycle rows are populated by the existing Pilot submission RPC in the
-- attachment migration; this table preserves each subsequent review decision.
