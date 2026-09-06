-- Clean-install Purchase Order table foundation for Direct and Material Indent sources.
-- rfq_number_snapshot is retained as compatibility metadata only; it has no relationship dependency.

create table if not exists public.procurement_purchase_order_sequences (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete restrict,
  year_month text not null,
  next_number integer not null default 1 check (next_number > 0),
  primary key (organization_id, company_id, year_month)
);

create table if not exists public.procurement_purchase_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete restrict,
  site_id uuid not null references public.sites(id) on delete restrict,
  po_number text not null,
  po_date date not null default current_date,
  revision_no integer not null default 0 check (revision_no >= 0),
  rfq_number_snapshot text not null default '',
  source_requisition_id uuid references public.purchase_requisitions(id) on delete restrict,
  source_requisition_number_snapshot text,
  vendor_id uuid references public.vendors(id) on delete restrict,
  vendor_name_snapshot text not null,
  vendor_snapshot jsonb not null default '{}'::jsonb,
  delivery_snapshot jsonb not null default '{}'::jsonb,
  commercial_snapshot jsonb not null default '{}'::jsonb,
  standard_terms_snapshot text not null default '',
  status text not null default 'draft' check (status in ('draft', 'pending_approval', 'approved', 'issued', 'sent_back', 'rejected')),
  total_basic_amount numeric(14,2) not null default 0 check (total_basic_amount >= 0),
  total_gst_amount numeric(14,2) not null default 0 check (total_gst_amount >= 0),
  total_freight_amount numeric(14,2) not null default 0 check (total_freight_amount >= 0),
  total_amount numeric(14,2) not null default 0 check (total_amount >= 0),
  created_by uuid,
  created_by_name text,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_by_name text,
  updated_by_email text,
  updated_at timestamptz not null default now(),
  submitted_by uuid,
  submitted_by_name text,
  submitted_at timestamptz,
  approved_by uuid,
  approved_by_name text,
  approved_at timestamptz,
  issued_by uuid,
  issued_by_name text,
  issued_at timestamptz,
  source_type text not null default 'direct' check (source_type in ('direct', 'indent')),
  source_requisition_line_key uuid,
  creation_request_id uuid,
  template_id uuid references public.procurement_purchase_order_templates(id) on delete restrict,
  template_version_id uuid references public.procurement_purchase_order_template_versions(id) on delete restrict,
  template_snapshot jsonb,
  total_additional_charges_amount numeric(14,2) check (total_additional_charges_amount is null or total_additional_charges_amount >= 0),
  supporting_documents_manifest jsonb,
  constraint procurement_purchase_orders_source_trace_check check (
    (source_type = 'direct' and source_requisition_id is null)
    or (source_type = 'indent' and source_requisition_id is not null)
  ),
  constraint procurement_purchase_orders_number_uidx unique (organization_id, po_number)
);

create table if not exists public.procurement_purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.procurement_purchase_orders(id) on delete restrict,
  item_code_snapshot text,
  item_name_snapshot text not null,
  specification_snapshot text,
  make_snapshot text,
  hsn_sac_snapshot text,
  quantity numeric(14,3) not null check (quantity > 0),
  uom_snapshot text not null,
  unit_rate numeric(14,4),
  discount_percent numeric(7,4),
  discount_amount numeric(14,2),
  taxable_amount numeric(14,2) not null default 0,
  gst_rate numeric(7,4),
  gst_amount numeric(14,2) not null default 0,
  total_amount numeric(14,2) not null default 0,
  remarks_snapshot text,
  sort_order integer not null default 1,
  created_at timestamptz not null default now(),
  source_requisition_id uuid references public.purchase_requisitions(id) on delete restrict,
  source_requisition_line_key uuid
);

create table if not exists public.procurement_purchase_order_events (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.procurement_purchase_orders(id) on delete restrict,
  event_type text not null,
  event_note text,
  actor_id uuid,
  actor_name text,
  actor_email text,
  changes jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.procurement_purchase_order_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  purchase_order_id uuid not null references public.procurement_purchase_orders(id) on delete restrict,
  document_type text not null,
  original_file_name text not null,
  storage_provider text not null default 'supabase',
  storage_bucket text not null,
  storage_key text not null,
  mime_type text,
  size_bytes bigint,
  status text not null default 'active' check (status in ('active', 'deleted')),
  created_by uuid,
  created_by_name text,
  created_by_email text,
  created_at timestamptz not null default now(),
  sort_order integer,
  constraint procurement_purchase_order_documents_storage_uidx unique (storage_bucket, storage_key)
);

create index if not exists procurement_purchase_orders_scope_idx
  on public.procurement_purchase_orders (organization_id, company_id, site_id, status, created_at desc);

create index if not exists procurement_purchase_orders_source_idx
  on public.procurement_purchase_orders (source_type, source_requisition_id, status);

create unique index if not exists procurement_purchase_orders_creation_request_uidx
  on public.procurement_purchase_orders (organization_id, creation_request_id)
  where creation_request_id is not null;

create index if not exists procurement_purchase_order_items_po_idx
  on public.procurement_purchase_order_items (purchase_order_id, sort_order);

create index if not exists procurement_purchase_order_items_source_idx
  on public.procurement_purchase_order_items (source_requisition_id, source_requisition_line_key);

create index if not exists procurement_purchase_order_events_po_idx
  on public.procurement_purchase_order_events (purchase_order_id, created_at desc);
