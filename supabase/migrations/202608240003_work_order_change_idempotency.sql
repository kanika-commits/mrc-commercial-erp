alter table public.work_order_changes
  add column if not exists creation_request_id uuid;

create unique index if not exists work_order_changes_creation_request_uidx
  on public.work_order_changes (organization_id, work_order_id, creation_request_id)
  where creation_request_id is not null;
