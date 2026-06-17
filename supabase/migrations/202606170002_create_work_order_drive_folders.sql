create table if not exists public.work_order_drive_folders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  drive_folder_id text not null,
  drive_folder_name text not null,
  ra_bills_folder_id text not null,
  invoices_folder_id text not null,
  debit_notes_folder_id text not null,
  contractor_docs_folder_id text not null,
  created_at timestamptz not null default now(),
  unique (work_order_id),
  unique (drive_folder_id)
);

create index if not exists work_order_drive_folders_organization_idx
  on public.work_order_drive_folders (organization_id);

