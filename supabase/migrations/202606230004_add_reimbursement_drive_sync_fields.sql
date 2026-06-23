alter table public.reimbursement_claims
  add column if not exists drive_folder_id text,
  add column if not exists drive_folder_url text,
  add column if not exists drive_sync_status text,
  add column if not exists drive_sync_error text;

alter table public.reimbursement_documents
  add column if not exists drive_file_id text,
  add column if not exists drive_file_url text;

create index if not exists reimbursement_claims_drive_sync_status_idx
  on public.reimbursement_claims (drive_sync_status);
