-- Pilot-only Drive filing ledger. Prepare only; do not apply automatically.
create table if not exists public.work_order_pilot_ra_bill_drive_files (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  ra_bill_id uuid not null references public.work_order_pilot_ra_bills(id) on delete cascade,
  cycle_id uuid not null references public.work_order_pilot_ra_bill_review_cycles(id) on delete cascade,
  manifest_attachment_id uuid,
  kind text not null check (kind in ('reviewed_pdf', 'supporting_document')),
  file_name text not null,
  drive_file_id text not null,
  drive_file_url text,
  sha256 text not null,
  byte_length bigint not null,
  created_at timestamptz not null default now(),
  unique (cycle_id, file_name),
  unique (cycle_id, kind, manifest_attachment_id)
);
create index if not exists work_order_pilot_ra_bill_drive_files_cycle_idx
  on public.work_order_pilot_ra_bill_drive_files(cycle_id, created_at);
grant all on public.work_order_pilot_ra_bill_drive_files to service_role;
