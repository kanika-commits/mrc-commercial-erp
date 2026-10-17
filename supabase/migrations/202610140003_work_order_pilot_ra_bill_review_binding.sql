-- Prepared only. Apply separately; Pilot RA Bill review binding only.
alter table public.work_order_pilot_ra_bill_review_cycles
  add column if not exists reviewed_input_snapshot_sha256 text;

create or replace function public.submit_work_order_pilot_ra_bill_with_cycle(
  p_id uuid, p_pdf_bytes bytea, p_pdf_sha256 text, p_pdf_length integer,
  p_manifest jsonb, p_manifest_sha256 text, p_actor uuid,
  p_reviewed_input_snapshot_sha256 text
)
returns public.work_order_pilot_ra_bills language plpgsql security definer set search_path=public as $$
declare result public.work_order_pilot_ra_bills; n integer; cycle_id uuid;
begin
  if coalesce(trim(p_reviewed_input_snapshot_sha256), '') = '' then
    raise exception 'A reviewed Pilot input snapshot binding is required';
  end if;
  select coalesce(max(cycle_number),0)+1 into n from public.work_order_pilot_ra_bill_review_cycles where ra_bill_id=p_id;
  update public.work_order_pilot_ra_bills set status='submitted', submitted_at=now(), updated_at=now(), attachments_snapshot=p_manifest, attachments_manifest_sha256=p_manifest_sha256, reviewed_pdf_sha256=p_pdf_sha256, reviewed_pdf_byte_length=p_pdf_length where id=p_id and status in ('draft','sent_back') returning * into result;
  if result.id is null then raise exception 'Only a draft or sent-back Pilot RA Bill can be submitted'; end if;
  insert into public.work_order_pilot_ra_bill_review_cycles(ra_bill_id,organization_id,cycle_number,status,reviewed_pdf_sha256,reviewed_pdf_byte_length,pdf_bytes,attachment_manifest,attachment_manifest_sha256,submitted_by,reviewed_input_snapshot_sha256) values(p_id,result.organization_id,n,'submitted',p_pdf_sha256,p_pdf_length,p_pdf_bytes,p_manifest,p_manifest_sha256,p_actor,p_reviewed_input_snapshot_sha256) returning id into cycle_id;
  update public.work_order_pilot_ra_bill_attachments set status='submitted', submitted_at=now() where ra_bill_id=p_id and status='draft';
  insert into public.work_order_pilot_ra_bill_review_audit(ra_bill_id,cycle_id,organization_id,action,actor_id) values(p_id,cycle_id,result.organization_id,'submitted',p_actor);
  return result;
end; $$;
revoke all on function public.submit_work_order_pilot_ra_bill_with_cycle(uuid,bytea,text,integer,jsonb,text,uuid,text) from public, anon, authenticated;
grant execute on function public.submit_work_order_pilot_ra_bill_with_cycle(uuid,bytea,text,integer,jsonb,text,uuid,text) to service_role;
