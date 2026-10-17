-- Additive Pilot-only attachment metadata. Apply separately; never reuse legacy RA Bill storage.
insert into storage.buckets (id, name, public)
values ('work-order-pilot-ra-bill-attachments', 'work-order-pilot-ra-bill-attachments', false)
on conflict (id) do nothing;

create table if not exists public.work_order_pilot_ra_bill_attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  ra_bill_id uuid not null references public.work_order_pilot_ra_bills(id) on delete cascade,
  original_file_name text not null,
  mime_type text not null,
  size_bytes bigint not null,
  storage_bucket text not null default 'work-order-pilot-ra-bill-attachments',
  storage_key text not null unique,
  sha256 text not null,
  status text not null default 'draft' check (status in ('draft','submitted','approved','removed')),
  created_by uuid,
  created_at timestamptz not null default now(),
  submitted_at timestamptz
);
create index if not exists work_order_pilot_ra_bill_attachments_bill_idx on public.work_order_pilot_ra_bill_attachments(ra_bill_id, created_at);
alter table public.work_order_pilot_ra_bills add column if not exists attachments_snapshot jsonb not null default '[]'::jsonb;
alter table public.work_order_pilot_ra_bills add column if not exists attachments_manifest_sha256 text;
grant all on public.work_order_pilot_ra_bill_attachments to service_role;

create or replace function public.submit_work_order_pilot_ra_bill_with_attachments(p_id uuid, p_manifest jsonb, p_manifest_sha256 text)
returns public.work_order_pilot_ra_bills language plpgsql security definer set search_path = public as $$
declare result public.work_order_pilot_ra_bills;
begin
  update public.work_order_pilot_ra_bills
    set status='submitted', submitted_at=now(), updated_at=now(), attachments_snapshot=p_manifest, attachments_manifest_sha256=p_manifest_sha256
    where id=p_id and status='draft' returning * into result;
  if result.id is null then raise exception 'Only a draft Pilot RA Bill can be submitted'; end if;
  update public.work_order_pilot_ra_bill_attachments set status='submitted', submitted_at=now()
    where ra_bill_id=p_id and status='draft';
  return result;
end; $$;
revoke all on function public.submit_work_order_pilot_ra_bill_with_attachments(uuid,jsonb,text) from public, anon, authenticated;
grant execute on function public.submit_work_order_pilot_ra_bill_with_attachments(uuid,jsonb,text) to service_role;

create or replace function public.submit_work_order_pilot_ra_bill_with_cycle(p_id uuid, p_pdf_bytes bytea, p_pdf_sha256 text, p_pdf_length integer, p_manifest jsonb, p_manifest_sha256 text, p_actor uuid)
returns public.work_order_pilot_ra_bills language plpgsql security definer set search_path=public as $$
declare result public.work_order_pilot_ra_bills; n integer; cycle_id uuid;
begin
  select coalesce(max(cycle_number),0)+1 into n from public.work_order_pilot_ra_bill_review_cycles where ra_bill_id=p_id;
  update public.work_order_pilot_ra_bills set status='submitted', submitted_at=now(), updated_at=now(), attachments_snapshot=p_manifest, attachments_manifest_sha256=p_manifest_sha256, reviewed_pdf_sha256=p_pdf_sha256, reviewed_pdf_byte_length=p_pdf_length where id=p_id and status in ('draft','sent_back') returning * into result;
  if result.id is null then raise exception 'Only a draft or sent-back Pilot RA Bill can be submitted'; end if;
  insert into public.work_order_pilot_ra_bill_review_cycles(ra_bill_id,organization_id,cycle_number,status,reviewed_pdf_sha256,reviewed_pdf_byte_length,pdf_bytes,attachment_manifest,attachment_manifest_sha256,submitted_by) values(p_id,result.organization_id,n,'submitted',p_pdf_sha256,p_pdf_length,p_pdf_bytes,p_manifest,p_manifest_sha256,p_actor) returning id into cycle_id;
  update public.work_order_pilot_ra_bill_attachments set status='submitted', submitted_at=now() where ra_bill_id=p_id and status='draft';
  insert into public.work_order_pilot_ra_bill_review_audit(ra_bill_id,cycle_id,organization_id,action,actor_id) values(p_id,cycle_id,result.organization_id,'submitted',p_actor);
  return result;
end; $$;
revoke all on function public.submit_work_order_pilot_ra_bill_with_cycle(uuid,bytea,text,integer,jsonb,text,uuid) from public, anon, authenticated;
grant execute on function public.submit_work_order_pilot_ra_bill_with_cycle(uuid,bytea,text,integer,jsonb,text,uuid) to service_role;
