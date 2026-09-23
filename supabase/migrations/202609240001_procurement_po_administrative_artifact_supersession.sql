begin;

-- Archived artifact rows and their storage objects remain protected by the
-- existing immutability trigger from 202609220002.
alter table public.procurement_purchase_order_artifacts
  drop constraint if exists procurement_purchase_order_artifacts_unique_po_type;

alter table public.procurement_purchase_order_artifacts
  add constraint procurement_purchase_order_artifacts_org_id_unique
  unique (organization_id, id);

alter table public.procurement_purchase_order_artifacts
  drop constraint if exists procurement_purchase_order_artifacts_origin_check;
alter table public.procurement_purchase_order_artifacts
  add constraint procurement_purchase_order_artifacts_origin_check
  check (archive_origin in ('approval', 'reconstruction', 'administrative_correction'));

create unique index if not exists procurement_purchase_order_artifacts_normal_approval_unique
  on public.procurement_purchase_order_artifacts (organization_id, purchase_order_id, artifact_type)
  where archive_origin = 'approval';

create table if not exists public.procurement_purchase_order_artifact_current (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  purchase_order_id uuid not null references public.procurement_purchase_orders(id) on delete restrict,
  artifact_id uuid not null,
  previous_artifact_id uuid,
  correction_reason text not null,
  correction_fields jsonb not null,
  corrected_by uuid,
  corrected_at timestamptz not null default now(),
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, purchase_order_id),
  unique (idempotency_key),
  foreign key (organization_id, artifact_id)
    references public.procurement_purchase_order_artifacts(organization_id, id),
  foreign key (organization_id, previous_artifact_id)
    references public.procurement_purchase_order_artifacts(organization_id, id),
  constraint procurement_purchase_order_artifact_current_reason_check
    check (length(btrim(correction_reason)) > 0),
  constraint procurement_purchase_order_artifact_current_fields_check
    check (jsonb_typeof(correction_fields) = 'object')
);

create index if not exists procurement_purchase_order_artifact_current_artifact_idx
  on public.procurement_purchase_order_artifact_current (artifact_id);

alter table public.procurement_purchase_order_artifact_current enable row level security;
revoke all on table public.procurement_purchase_order_artifact_current from public, anon, authenticated;
grant all on table public.procurement_purchase_order_artifact_current to service_role;

create or replace function public.finalize_procurement_po_vendor_contact_correction(
  p_organization_id uuid,
  p_purchase_order_id uuid,
  p_new_artifact_id uuid,
  p_expected_previous_artifact_id uuid,
  p_expected_contact_person text,
  p_expected_phone text,
  p_expected_email text,
  p_expected_designation text,
  p_contact_person text,
  p_phone text,
  p_email text,
  p_designation text,
  p_reason text,
  p_actor jsonb,
  p_idempotency_key uuid
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_po public.procurement_purchase_orders%rowtype;
  v_previous public.procurement_purchase_order_artifacts%rowtype;
  v_new public.procurement_purchase_order_artifacts%rowtype;
  v_current public.procurement_purchase_order_artifact_current%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_snapshot jsonb;
  v_has_current boolean := false;
  v_legacy_count integer;
begin
  if nullif(btrim(p_reason), '') is null then raise exception 'Correction reason is required.'; end if;
  if p_idempotency_key is null then raise exception 'Idempotency key is required.'; end if;

  select * into v_current from public.procurement_purchase_order_artifact_current
    where organization_id = p_organization_id and purchase_order_id = p_purchase_order_id;
  v_has_current := found;
  if found and v_current.idempotency_key = p_idempotency_key then
    return jsonb_build_object('purchase_order_id', p_purchase_order_id,
      'artifact_id', v_current.artifact_id, 'previous_artifact_id', v_current.previous_artifact_id,
      'idempotent', true);
  end if;
  if exists (select 1 from public.procurement_purchase_order_artifact_current where idempotency_key = p_idempotency_key) then
    raise exception 'Idempotency key belongs to another correction.';
  end if;

  select * into v_po from public.procurement_purchase_orders
    where id = p_purchase_order_id and organization_id = p_organization_id for update;
  if not found then raise exception 'Purchase Order was not found in the requested organization.'; end if;
  if v_po.status <> 'approved' then raise exception 'Only approved Purchase Orders can be corrected.'; end if;

  if v_has_current then
    select * into v_previous from public.procurement_purchase_order_artifacts where id = v_current.artifact_id for update;
  else
    select count(*) into v_legacy_count from public.procurement_purchase_order_artifacts
      where organization_id = p_organization_id and purchase_order_id = p_purchase_order_id
        and artifact_type = 'official_po' and artifact_status = 'archived'
        and archive_origin = 'approval' and sha256 is not null and btrim(sha256) <> '' and size_bytes is not null and size_bytes > 0;
    if v_legacy_count = 0 then raise exception 'No qualifying legacy approval artifact exists.'; end if;
    if v_legacy_count > 1 then raise exception 'Ambiguous legacy approval artifacts exist.'; end if;
    select * into v_previous from public.procurement_purchase_order_artifacts
      where organization_id = p_organization_id and purchase_order_id = p_purchase_order_id
        and artifact_type = 'official_po' and artifact_status = 'archived'
        and archive_origin = 'approval' and sha256 is not null and btrim(sha256) <> '' and size_bytes is not null and size_bytes > 0
      for update;
  end if;
  if not found then raise exception 'Authoritative archived official Purchase Order artifact was not found.'; end if;
  if v_previous.organization_id <> p_organization_id or v_previous.purchase_order_id <> p_purchase_order_id
     or v_previous.artifact_type <> 'official_po' or v_previous.artifact_status <> 'archived'
     or v_previous.sha256 is null or btrim(v_previous.sha256) = '' or v_previous.size_bytes is null or v_previous.size_bytes <= 0 then
    raise exception 'Previous artifact ownership or integrity validation failed.';
  end if;
  if p_expected_previous_artifact_id is distinct from v_previous.id then raise exception 'Stale previous artifact.'; end if;

  select * into v_new from public.procurement_purchase_order_artifacts where id = p_new_artifact_id for update;
  if not found or v_new.organization_id <> p_organization_id or v_new.purchase_order_id <> p_purchase_order_id
     or v_new.artifact_type <> 'official_po' or v_new.artifact_status <> 'archived'
     or v_new.sha256 is null or btrim(v_new.sha256) = '' or v_new.size_bytes is null or v_new.size_bytes <= 0 or v_new.id = v_previous.id then
    raise exception 'New artifact ownership, type, status, or integrity validation failed.';
  end if;
  if exists (select 1 from public.procurement_purchase_order_artifact_current where artifact_id = v_new.id) then
    raise exception 'New artifact is already current.';
  end if;

  v_before := jsonb_build_object('contact_person', v_po.vendor_snapshot->>'contact_person', 'phone', v_po.vendor_snapshot->>'phone', 'email', v_po.vendor_snapshot->>'email', 'designation', v_po.vendor_snapshot->>'designation');
  if v_before->>'contact_person' is distinct from p_expected_contact_person or v_before->>'phone' is distinct from p_expected_phone or v_before->>'email' is distinct from p_expected_email or v_before->>'designation' is distinct from p_expected_designation then raise exception 'Stale vendor contact snapshot.'; end if;
  v_after := jsonb_build_object('contact_person', p_contact_person, 'phone', p_phone, 'email', p_email, 'designation', p_designation);
  v_snapshot := coalesce(v_po.vendor_snapshot, '{}'::jsonb) || v_after;

  update public.procurement_purchase_orders set vendor_snapshot = v_snapshot
    where id = v_po.id and organization_id = p_organization_id and status = 'approved';
  if not found then raise exception 'Purchase Order changed during correction.'; end if;
  if v_has_current then
    update public.procurement_purchase_order_artifact_current set artifact_id=v_new.id, previous_artifact_id=v_previous.id, correction_reason=p_reason, correction_fields=jsonb_build_object('type','approved_po_vendor_contact_administrative_correction','before',v_before,'after',v_after,'commercial_values_changed',false), corrected_by=nullif(p_actor->>'user_id','')::uuid, corrected_at=now(), idempotency_key=p_idempotency_key where organization_id=p_organization_id and purchase_order_id=p_purchase_order_id;
  else
    insert into public.procurement_purchase_order_artifact_current(organization_id,purchase_order_id,artifact_id,previous_artifact_id,correction_reason,correction_fields,corrected_by,idempotency_key)
      values (p_organization_id,p_purchase_order_id,v_new.id,v_previous.id,p_reason,jsonb_build_object('type','approved_po_vendor_contact_administrative_correction','before',v_before,'after',v_after,'commercial_values_changed',false),nullif(p_actor->>'user_id','')::uuid,p_idempotency_key);
  end if;
  insert into public.erp_audit_logs(organization_id,module_code,entity_type,record_id,action,description,old_values,new_values,source,created_by,created_by_name,created_by_email)
    values (p_organization_id,'procurement_purchase_orders','approved_po_vendor_contact_correction',p_purchase_order_id,'manual_event','Administrative correction of approved Purchase Order vendor contact.',jsonb_build_object('po_number',v_po.po_number,'artifact_id',v_previous.id,'vendor_contact',v_before),jsonb_build_object('correction_type','approved_po_vendor_contact_administrative_correction','reason',p_reason,'artifact_id',v_new.id,'vendor_contact',v_after,'commercial_values_changed',false), 'api',nullif(p_actor->>'user_id','')::uuid,p_actor->>'name',p_actor->>'email');
  return jsonb_build_object('purchase_order_id', p_purchase_order_id, 'artifact_id', v_new.id, 'previous_artifact_id', v_previous.id, 'idempotent', false);
end;
$$;

revoke all on function public.finalize_procurement_po_vendor_contact_correction(uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,jsonb,uuid) from public, anon, authenticated;
grant execute on function public.finalize_procurement_po_vendor_contact_correction(uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,jsonb,uuid) to service_role;

commit;
