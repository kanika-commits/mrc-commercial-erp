-- Prepared only: review and apply separately before enabling Pilot approval sync.
alter table public.work_orders
  add column if not exists pilot_drive_sync_status text,
  add column if not exists pilot_drive_sync_error text,
  add column if not exists pilot_drive_sync_started_at timestamptz,
  add column if not exists pilot_drive_sync_completed_at timestamptz;

alter table public.work_order_documents
  add column if not exists drive_sync_key text,
  add column if not exists drive_sync_status text,
  add column if not exists drive_sync_error text;

create unique index if not exists work_order_documents_drive_sync_key_uidx
  on public.work_order_documents(work_order_id, drive_sync_key)
  where drive_sync_key is not null;

create index if not exists work_orders_pilot_drive_sync_status_idx
  on public.work_orders(pilot_drive_sync_status)
  where pilot_drive_sync_status is not null;
