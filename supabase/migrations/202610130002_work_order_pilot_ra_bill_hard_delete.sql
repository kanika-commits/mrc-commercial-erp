-- Forward-only Pilot RA Bill hard-delete cleanup.  Do not apply automatically.
-- The audit row intentionally has no FK so it survives removal of the bill.
alter table public.work_order_pilot_ra_bill_deletion_audit
  drop constraint if exists work_order_pilot_ra_bill_deletion_audit_ra_bill_id_fkey;
alter table public.work_order_pilot_ra_bill_deletion_audit
  add column if not exists bill_number text,
  add column if not exists cleanup_status text not null default 'pending',
  add column if not exists cleanup_error text,
  add column if not exists attachment_cleanup jsonb not null default '[]'::jsonb,
  add column if not exists drive_cleanup jsonb not null default '[]'::jsonb,
  add column if not exists cleanup_updated_at timestamptz not null default now();

alter table public.work_order_pilot_ra_bill_deletion_audit
  drop constraint if exists work_order_pilot_ra_bill_deletion_audit_cleanup_status_check;
alter table public.work_order_pilot_ra_bill_deletion_audit
  add constraint work_order_pilot_ra_bill_deletion_audit_cleanup_status_check
  check (cleanup_status in ('pending', 'external_cleanup', 'ready_for_db_delete', 'complete', 'failed'));

create index if not exists work_order_pilot_ra_bill_deletion_audit_cleanup_idx
  on public.work_order_pilot_ra_bill_deletion_audit(ra_bill_id, cleanup_status);

create or replace function public.prepare_hard_delete_work_order_pilot_ra_bill(
  p_id uuid, p_actor uuid, p_reason text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare b record; a record; payload jsonb;
begin
  if nullif(trim(p_reason), '') is null then raise exception 'A deletion reason is required'; end if;
  select b0.id, b0.organization_id, b0.bill_number, b0.status, w.creation_request_id,
         w.organization_id as work_order_organization_id
    into b
    from public.work_order_pilot_ra_bills b0
    join public.work_orders w on w.id = b0.work_order_id
   where b0.id = p_id for update;
  if b.id is null or b.creation_request_id is null or b.organization_id <> b.work_order_organization_id
     or b.status not in ('draft', 'approved') then raise exception 'Pilot RA Bill is not eligible for deletion'; end if;
  select * into a from public.work_order_pilot_ra_bill_deletion_audit
   where ra_bill_id = p_id order by deleted_at desc limit 1 for update;
  if a.id is not null then
    if a.cleanup_status = 'complete' then return jsonb_build_object('audit_id', a.id, 'status', a.cleanup_status); end if;
    update public.work_order_pilot_ra_bill_deletion_audit set cleanup_error = null, cleanup_updated_at = now() where id = a.id;
  else
    insert into public.work_order_pilot_ra_bill_deletion_audit
      (organization_id, ra_bill_id, bill_number, actor_id, reason, prior_status, cleanup_status)
    values (b.organization_id, b.id, b.bill_number, p_actor, trim(p_reason), b.status, 'external_cleanup') returning * into a;
  end if;
  payload := jsonb_build_object(
    'audit_id', a.id, 'status', 'external_cleanup',
    'attachments', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'bucket', storage_bucket, 'key', storage_key)) from public.work_order_pilot_ra_bill_attachments where ra_bill_id=p_id), '[]'::jsonb),
    'drive_files', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'drive_file_id', drive_file_id)) from public.work_order_pilot_ra_bill_drive_files where ra_bill_id=p_id), '[]'::jsonb));
  update public.work_order_pilot_ra_bill_deletion_audit set attachment_cleanup=payload->'attachments', drive_cleanup=payload->'drive_files', cleanup_status='external_cleanup', cleanup_updated_at=now() where id=a.id;
  return payload;
end; $$;

create or replace function public.finalize_hard_delete_work_order_pilot_ra_bill(
  p_id uuid, p_audit_id uuid
) returns jsonb language plpgsql security definer set search_path = public as $$
declare a record; b record;
begin
  select * into a from public.work_order_pilot_ra_bill_deletion_audit where id=p_audit_id and ra_bill_id=p_id for update;
  if a.id is null then raise exception 'Pilot deletion audit not found'; end if;
  if a.cleanup_status = 'complete' then return jsonb_build_object('deleted', true, 'idempotent', true); end if;
  select b0.id, b0.organization_id, w.creation_request_id, w.organization_id as work_order_organization_id into b
    from public.work_order_pilot_ra_bills b0 join public.work_orders w on w.id=b0.work_order_id where b0.id=p_id for update;
  if b.id is null or b.creation_request_id is null or b.organization_id <> b.work_order_organization_id then raise exception 'Pilot ownership verification failed'; end if;
  delete from public.work_order_pilot_ra_bill_review_audit where ra_bill_id=p_id;
  delete from public.work_order_pilot_ra_bill_drive_files where ra_bill_id=p_id;
  delete from public.work_order_pilot_ra_bill_attachments where ra_bill_id=p_id;
  delete from public.work_order_pilot_ra_bill_reviewed_artifacts where ra_bill_id=p_id;
  delete from public.work_order_pilot_ra_bill_review_cycles where ra_bill_id=p_id;
  delete from public.work_order_pilot_ra_bill_items where ra_bill_id=p_id;
  delete from public.work_order_pilot_ra_bills where id=p_id;
  update public.work_order_pilot_ra_bill_deletion_audit set cleanup_status='complete', cleanup_error=null, cleanup_updated_at=now() where id=p_audit_id;
  return jsonb_build_object('deleted', true, 'idempotent', false);
end; $$;

create or replace function public.mark_hard_delete_work_order_pilot_ra_bill_cleanup_failed(
  p_audit_id uuid, p_error text
) returns void language sql security definer set search_path = public as $$
  update public.work_order_pilot_ra_bill_deletion_audit set cleanup_status='failed', cleanup_error=left(trim(p_error), 2000), cleanup_updated_at=now() where id=p_audit_id;
$$;

revoke all on function public.prepare_hard_delete_work_order_pilot_ra_bill(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.finalize_hard_delete_work_order_pilot_ra_bill(uuid,uuid) from public, anon, authenticated;
revoke all on function public.mark_hard_delete_work_order_pilot_ra_bill_cleanup_failed(uuid,text) from public, anon, authenticated;
grant execute on function public.prepare_hard_delete_work_order_pilot_ra_bill(uuid,uuid,text) to service_role;
grant execute on function public.finalize_hard_delete_work_order_pilot_ra_bill(uuid,uuid) to service_role;
grant execute on function public.mark_hard_delete_work_order_pilot_ra_bill_cleanup_failed(uuid,text) to service_role;
