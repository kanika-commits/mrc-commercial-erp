-- Add optional contact details used in the Purchase Order billing block.
alter table public.company_billing_addresses
  add column if not exists contact_name text,
  add column if not exists mobile text,
  add column if not exists email text;
