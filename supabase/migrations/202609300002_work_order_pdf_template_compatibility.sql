-- Prepared only: do not apply without review.
-- Reuses existing Purchase Order template/version records without changing their behavior.
alter table public.procurement_purchase_order_templates
  add column if not exists supports_work_orders boolean not null default false;

alter table public.work_orders
  add column if not exists template_id uuid references public.procurement_purchase_order_templates(id) on delete restrict,
  add column if not exists template_version_id uuid references public.procurement_purchase_order_template_versions(id) on delete restrict,
  add column if not exists template_snapshot jsonb,
  add column if not exists generated_pdf_file_id text,
  add column if not exists generated_pdf_file_url text,
  add column if not exists generated_pdf_uploaded_at timestamptz,
  add column if not exists generated_pdf_upload_key text;

create index if not exists work_orders_template_idx on public.work_orders(template_id, template_version_id);
create unique index if not exists work_orders_generated_pdf_key_uidx on public.work_orders(generated_pdf_upload_key) where generated_pdf_upload_key is not null;
