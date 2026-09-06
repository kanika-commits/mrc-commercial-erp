-- Purchase Order visual template master foundation. Apply manually after review.
create table if not exists public.procurement_purchase_order_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete restrict,
  template_name text not null check (length(trim(template_name)) > 0),
  template_code text not null check (length(trim(template_code)) > 0),
  status text not null default 'active' check (status in ('active', 'inactive')),
  is_default boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint procurement_po_templates_code_uidx unique (organization_id, company_id, template_code)
);

create table if not exists public.procurement_purchase_order_template_versions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.procurement_purchase_order_templates(id) on delete restrict,
  version_number integer not null check (version_number > 0),
  status text not null default 'active' check (status in ('active', 'inactive')),
  layout_definition jsonb not null default '{}'::jsonb,
  header_asset_reference text,
  footer_asset_reference text,
  source_storage_bucket text,
  source_storage_path text,
  source_original_filename text,
  source_mime_type text,
  source_size_bytes bigint,
  source_uploaded_at timestamptz,
  source_uploaded_by uuid references public.profiles(id) on delete set null,
  readiness_status text not null default 'setup_required' check (readiness_status in ('setup_required', 'ready')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint procurement_po_template_versions_uidx unique (template_id, version_number)
);

alter table public.procurement_purchase_orders add column if not exists template_id uuid references public.procurement_purchase_order_templates(id) on delete restrict;
alter table public.procurement_purchase_orders add column if not exists template_version_id uuid references public.procurement_purchase_order_template_versions(id) on delete restrict;
alter table public.procurement_purchase_orders add column if not exists template_snapshot jsonb;

create unique index if not exists procurement_po_templates_default_uidx on public.procurement_purchase_order_templates(company_id) where is_default and status = 'active';
create index if not exists procurement_po_templates_scope_idx on public.procurement_purchase_order_templates(organization_id, company_id, status);
create index if not exists procurement_po_template_versions_template_idx on public.procurement_purchase_order_template_versions(template_id, version_number desc);

alter table public.procurement_purchase_order_templates enable row level security;
alter table public.procurement_purchase_order_template_versions enable row level security;
revoke all on table public.procurement_purchase_order_templates, public.procurement_purchase_order_template_versions from public, anon, authenticated;
grant all on table public.procurement_purchase_order_templates, public.procurement_purchase_order_template_versions to service_role;

insert into storage.buckets (id, name, public)
values ('procurement-po-template-documents', 'procurement-po-template-documents', false)
on conflict (id) do nothing;
