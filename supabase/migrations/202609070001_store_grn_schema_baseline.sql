begin;

create table if not exists public.procurement_goods_receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  company_id uuid not null references public.companies(id),
  site_id uuid not null references public.sites(id),
  purchase_order_id uuid not null references public.procurement_purchase_orders(id),
  grn_number text not null,
  grn_date date not null default current_date,
  supplier_challan_number text,
  supplier_challan_date date,
  received_date date not null default current_date,
  received_by text,
  vehicle_number text,
  freight_paid_by text,
  freight_amount numeric(14,2),
  remarks text,
  po_snapshot jsonb not null default '{}'::jsonb,
  finalized_remarks text,
  normalized_received_kg numeric(18,3),
  weighbridge_net_kg numeric(18,3),
  weight_difference_kg numeric(18,3),
  weight_reconciliation_status text,
  weight_reconciliation_remarks text,
  status text not null default 'draft' check (status in ('draft', 'finalized')),
  created_by uuid,
  created_by_name text,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_by_name text,
  updated_by_email text,
  updated_at timestamptz not null default now(),
  finalized_by uuid,
  finalized_by_name text,
  finalized_by_email text,
  finalized_at timestamptz,
  constraint procurement_goods_receipts_number_uidx unique (organization_id, grn_number),
  constraint procurement_goods_receipts_freight_amount_check check (freight_amount is null or freight_amount >= 0)
);

create table if not exists public.procurement_goods_receipt_items (
  id uuid primary key default gen_random_uuid(),
  grn_id uuid not null references public.procurement_goods_receipts(id) on delete cascade,
  purchase_order_item_id uuid not null references public.procurement_purchase_order_items(id),
  material_item_id uuid,
  item_code_snapshot text,
  item_name_snapshot text not null,
  specification_snapshot text,
  make_snapshot text,
  uom_snapshot text not null,
  ordered_quantity_snapshot numeric(14,3) not null check (ordered_quantity_snapshot >= 0),
  previously_accepted_quantity numeric(14,3) not null default 0 check (previously_accepted_quantity >= 0),
  remaining_quantity_snapshot numeric(14,3) not null default 0 check (remaining_quantity_snapshot >= 0),
  received_quantity numeric(14,3) not null default 0 check (received_quantity >= 0),
  accepted_quantity numeric(14,3) not null default 0 check (accepted_quantity >= 0),
  rejected_quantity numeric(14,3) not null default 0 check (rejected_quantity >= 0),
  hold_quantity numeric(14,3) not null default 0 check (hold_quantity >= 0),
  rejection_reason text,
  remarks text,
  weight_based boolean not null default false,
  weight_uom text,
  created_at timestamptz not null default now(),
  constraint procurement_goods_receipt_items_unique unique (grn_id, purchase_order_item_id),
  constraint procurement_goods_receipt_items_equation check (received_quantity = accepted_quantity + rejected_quantity + hold_quantity),
  constraint procurement_goods_receipt_items_rejection_reason check (rejected_quantity = 0 or nullif(btrim(rejection_reason), '') is not null)
);

create table if not exists public.procurement_goods_receipt_events (
  id uuid primary key default gen_random_uuid(),
  grn_id uuid not null references public.procurement_goods_receipts(id) on delete cascade,
  event_type text not null,
  event_note text,
  metadata jsonb not null default '{}'::jsonb,
  actor_id uuid,
  actor_name text,
  actor_email text,
  created_at timestamptz not null default now()
);

create table if not exists public.procurement_goods_receipt_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  grn_id uuid not null references public.procurement_goods_receipts(id) on delete cascade,
  document_type text not null,
  original_file_name text not null,
  storage_provider text not null default 'supabase',
  storage_bucket text not null,
  storage_key text not null,
  mime_type text,
  size_bytes bigint,
  status text not null default 'active' check (status in ('active', 'deleted', 'superseded')),
  capture_source text not null default 'upload',
  sort_order integer not null default 0,
  is_primary boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  superseded_by uuid references public.procurement_goods_receipt_documents(id),
  created_by uuid,
  created_by_name text,
  created_by_email text,
  created_at timestamptz not null default now(),
  constraint procurement_goods_receipt_documents_storage_uidx unique (storage_bucket, storage_key)
);

create table if not exists public.procurement_goods_receipt_verified_values (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  grn_id uuid not null references public.procurement_goods_receipts(id) on delete cascade,
  document_id uuid references public.procurement_goods_receipt_documents(id),
  field_name text not null,
  source_type text not null check (source_type in ('ocr', 'manual', 'corrected_ocr', 'system_calculated')),
  original_extracted_value text,
  final_value text,
  confidence numeric,
  verified_by uuid,
  verified_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create sequence if not exists public.procurement_goods_receipt_number_seq;

create index if not exists procurement_goods_receipts_scope_idx
  on public.procurement_goods_receipts(organization_id, company_id, site_id, status, created_at desc);
create index if not exists procurement_goods_receipts_po_idx
  on public.procurement_goods_receipts(purchase_order_id, status);
create index if not exists procurement_goods_receipts_date_idx
  on public.procurement_goods_receipts(organization_id, grn_date desc);
create index if not exists procurement_goods_receipt_items_grn_idx
  on public.procurement_goods_receipt_items(grn_id);
create index if not exists procurement_goods_receipt_items_po_item_idx
  on public.procurement_goods_receipt_items(purchase_order_item_id, grn_id);
create index if not exists procurement_goods_receipt_events_grn_idx
  on public.procurement_goods_receipt_events(grn_id, created_at desc);
create index if not exists procurement_goods_receipt_documents_grn_status_idx
  on public.procurement_goods_receipt_documents(grn_id, status, created_at desc);
create index if not exists procurement_grn_verified_values_grn_idx
  on public.procurement_goods_receipt_verified_values(grn_id, field_name, verified_at desc);

commit;
