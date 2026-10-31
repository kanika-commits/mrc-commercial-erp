-- Pilot-only additive rejection support. This migration is intentionally not applied here.
alter table public.work_order_pilot_ra_bill_review_cycles
  drop constraint if exists work_order_pilot_ra_bill_review_cycles_status_check;
alter table public.work_order_pilot_ra_bill_review_cycles
  add constraint work_order_pilot_ra_bill_review_cycles_status_check
  check (status in ('submitted', 'approved', 'sent_back', 'rejected'));

alter table public.work_order_pilot_ra_bill_review_audit
  drop constraint if exists work_order_pilot_ra_bill_review_audit_action_check;
alter table public.work_order_pilot_ra_bill_review_audit
  add constraint work_order_pilot_ra_bill_review_audit_action_check
  check (action in ('submitted', 'approved', 'sent_back', 'rejected'));

create or replace function public.reject_work_order_pilot_ra_bill(
  p_id uuid,
  p_reason text,
  p_actor uuid
)
returns public.work_order_pilot_ra_bills
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.work_order_pilot_ra_bills;
  current_cycle public.work_order_pilot_ra_bill_review_cycles;
begin
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A rejection reason is required';
  end if;

  select * into current_cycle
  from public.work_order_pilot_ra_bill_review_cycles
  where ra_bill_id = p_id and status = 'submitted'
  order by cycle_number desc
  limit 1;

  if current_cycle.id is null then
    raise exception 'Only a submitted Pilot RA Bill can be rejected';
  end if;

  update public.work_order_pilot_ra_bill_review_cycles
  set status = 'rejected', decided_by = p_actor, decided_at = now(), send_back_reason = trim(p_reason)
  where id = current_cycle.id;

  update public.work_order_pilot_ra_bills
  set status = 'rejected', updated_at = now()
  where id = p_id
  returning * into result;

  insert into public.work_order_pilot_ra_bill_review_audit
    (ra_bill_id, cycle_id, organization_id, action, actor_id, reason)
  values (p_id, current_cycle.id, result.organization_id, 'rejected', p_actor, trim(p_reason));

  return result;
end;
$$;

revoke all on function public.reject_work_order_pilot_ra_bill(uuid, text, uuid) from public;
grant execute on function public.reject_work_order_pilot_ra_bill(uuid, text, uuid) to service_role;
