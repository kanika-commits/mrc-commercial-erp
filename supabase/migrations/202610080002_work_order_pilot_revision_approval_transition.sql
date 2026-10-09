-- Forward-only Pilot revision approval transition.
-- This migration is additive and does not alter legacy Work Orders or financial flows.
alter table public.work_order_pilot_revisions
  add column if not exists send_back_comment text,
  add column if not exists sent_back_at timestamptz;

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

  if result.id is null then
    raise exception 'Only a submitted revision can be approved';
  end if;
  return result;
end;
$$;

revoke all on function public.approve_work_order_pilot_revision(uuid) from public, anon, authenticated;
grant execute on function public.approve_work_order_pilot_revision(uuid) to service_role;
