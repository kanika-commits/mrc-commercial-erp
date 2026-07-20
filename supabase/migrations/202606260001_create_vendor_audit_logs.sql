begin;

create table if not exists public.vendor_audit_logs (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  organization_id uuid null,
  action text not null check (action in ('created', 'updated', 'restored')),
  changed_by_user_id uuid null,
  changed_by_email text null,
  changed_by_name text null,
  changed_at timestamptz not null default now(),
  changed_fields text[] default '{}',
  old_values jsonb null,
  new_values jsonb null,
  restore_snapshot jsonb null,
  note text null
);

create index if not exists vendor_audit_logs_vendor_changed_idx
  on public.vendor_audit_logs (vendor_id, changed_at desc);

create index if not exists vendor_audit_logs_org_changed_idx
  on public.vendor_audit_logs (organization_id, changed_at desc);

commit;
