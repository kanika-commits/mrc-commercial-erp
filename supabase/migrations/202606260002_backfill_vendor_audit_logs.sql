begin;

insert into public.vendor_audit_logs (
  vendor_id,
  organization_id,
  action,
  changed_by_user_id,
  changed_by_email,
  changed_by_name,
  changed_at,
  changed_fields,
  old_values,
  new_values,
  restore_snapshot,
  note
)
select
  v.id,
  nullif(to_jsonb(v)->>'organization_id', '')::uuid,
  'created',
  nullif(to_jsonb(v)->>'created_by', '')::uuid,
  nullif(to_jsonb(v)->>'created_by_email', ''),
  nullif(to_jsonb(v)->>'created_by_name', ''),
  coalesce(nullif(to_jsonb(v)->>'created_at', '')::timestamptz, now()),
  array['existing_vendor_snapshot']::text[],
  null::jsonb,
  to_jsonb(v),
  to_jsonb(v),
  'Existing vendor snapshot created when activity log was enabled'
from public.vendors v
where not exists (
  select 1
  from public.vendor_audit_logs existing_log
  where existing_log.vendor_id = v.id
);

commit;
