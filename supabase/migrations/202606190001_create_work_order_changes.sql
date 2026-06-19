create table if not exists public.work_order_changes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  change_type text not null check (change_type in ('rate_terms_revision', 'additional_work')),
  change_number text not null,
  change_date date not null,
  applicable_date date,
  additional_work_value numeric,
  gst_percent numeric,
  gst_amount numeric,
  updated_wo_basic_value numeric,
  updated_total_wo_value numeric,
  description text,
  file_id text,
  file_url text,
  file_name text,
  file_mime_type text,
  created_by uuid,
  created_at timestamptz default now(),
  unique (work_order_id, change_type, change_number)
);

create index if not exists work_order_changes_work_order_idx
  on public.work_order_changes (work_order_id);

create index if not exists work_order_changes_organization_idx
  on public.work_order_changes (organization_id);

create index if not exists work_order_changes_change_type_idx
  on public.work_order_changes (change_type);

grant all on table public.work_order_changes to anon;
grant all on table public.work_order_changes to authenticated;
grant all on table public.work_order_changes to service_role;
