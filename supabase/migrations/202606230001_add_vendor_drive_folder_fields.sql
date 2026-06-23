alter table public.vendors
  add column if not exists vendor_drive_folder_id text,
  add column if not exists vendor_drive_folder_name text;
