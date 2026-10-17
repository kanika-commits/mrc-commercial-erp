-- Pilot-only forward migration: remove one bill's database rows while retaining
-- an exact external-cleanup tombstone.  Drive/Storage cleanup is intentionally
-- not performed by this function.

alter table public.work_order_pilot_ra_bill_deletion_audit
  add column if not exists work_order_id uuid;

alter table public.work_order_pilot_ra_bill_deletion_audit
  drop constraint if exists work_order_pilot_ra_bill_deletion_audit_cleanup_status_check;

alter table public.work_order_pilot_ra_bill_deletion_audit
  add constraint work_order_pilot_ra_bill_deletion_audit_cleanup_status_check
  check (cleanup_status in ('pending', 'external_cleanup', 'ready_for_db_delete', 'db_deleted_external_pending', 'complete', 'failed'));

create index if not exists work_order_pilot_ra_bill_deletion_audit_pending_cleanup_idx
  on public.work_order_pilot_ra_bill_deletion_audit(organization_id, work_order_id, cleanup_status);

create or replace function public.finalize_database_delete_pending_work_order_pilot_ra_bill(
  p_id uuid,
  p_audit_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a record;
  b record;
begin
  select * into a
    from public.work_order_pilot_ra_bill_deletion_audit
   where id = p_audit_id and ra_bill_id = p_id
   for update;

  if a.id is null then
    raise exception 'Pilot deletion audit not found';
  end if;

  if a.cleanup_status = 'db_deleted_external_pending' then
    return jsonb_build_object('database_deleted', true, 'idempotent', true, 'audit_id', a.id);
  end if;

  if a.cleanup_status not in ('failed', 'external_cleanup', 'ready_for_db_delete') then
    raise exception 'Pilot deletion audit is not ready for database-only finalization';
  end if;

  select b0.id, b0.organization_id, b0.bill_number, b0.work_order_id,
         w.creation_request_id, w.organization_id as work_order_organization_id
    into b
    from public.work_order_pilot_ra_bills b0
    join public.work_orders w on w.id = b0.work_order_id
   where b0.id = p_id
   for update;

  if b.id is null
     or b.creation_request_id is null
     or b.organization_id <> b.work_order_organization_id
     or b.organization_id <> a.organization_id then
    raise exception 'Pilot ownership or organization verification failed';
  end if;

  update public.work_order_pilot_ra_bill_deletion_audit
     set work_order_id = b.work_order_id,
         bill_number = coalesce(bill_number, b.bill_number),
         cleanup_status = 'db_deleted_external_pending',
         cleanup_error = 'Database rows deleted; exact external cleanup remains pending.',
         cleanup_updated_at = now()
   where id = a.id;

  -- Keep the tombstone and its exact cleanup manifests; remove only this
  -- Pilot bill's database-owned rows. External files are never touched here.
  delete from public.work_order_pilot_ra_bill_review_audit where ra_bill_id = p_id;
  delete from public.work_order_pilot_ra_bill_drive_files where ra_bill_id = p_id;
  delete from public.work_order_pilot_ra_bill_attachments where ra_bill_id = p_id;
  delete from public.work_order_pilot_ra_bill_reviewed_artifacts where ra_bill_id = p_id;
  delete from public.work_order_pilot_ra_bill_review_cycles where ra_bill_id = p_id;
  delete from public.work_order_pilot_ra_bill_items where ra_bill_id = p_id;
  delete from public.work_order_pilot_ra_bills where id = p_id;

  return jsonb_build_object('database_deleted', true, 'idempotent', false, 'audit_id', a.id,
                            'bill_number', coalesce(a.bill_number, b.bill_number),
                            'work_order_id', b.work_order_id,
                            'cleanup_status', 'db_deleted_external_pending');
end;
$$;

revoke all on function public.finalize_database_delete_pending_work_order_pilot_ra_bill(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.finalize_database_delete_pending_work_order_pilot_ra_bill(uuid, uuid)
  to service_role;
