-- Purpose is an optional descriptive header field. Existing values are preserved.
alter table public.purchase_requisitions
  alter column purpose drop not null;
