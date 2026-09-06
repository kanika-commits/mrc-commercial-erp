-- Add optional site/delivery contact details to reusable delivery addresses.
-- Existing delivery rows remain valid and are not rewritten.
alter table public.site_delivery_locations
  add column if not exists contact_name text,
  add column if not exists mobile text,
  add column if not exists email text;
