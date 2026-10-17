begin;

alter table public.work_orders
  add column if not exists work_order_key_terms jsonb not null default '{"inclusions":[],"exclusions":[]}'::jsonb;

commit;
