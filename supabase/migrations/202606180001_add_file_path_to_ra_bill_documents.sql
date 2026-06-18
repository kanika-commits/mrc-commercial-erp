alter table public.ra_bill_documents
  add column if not exists file_path text;

