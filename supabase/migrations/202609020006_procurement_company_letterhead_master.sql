-- Company Letterhead Master foundation. Apply manually after review.
create table if not exists public.procurement_company_letterheads (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete restrict, letterhead_name text not null check (length(trim(letterhead_name)) > 0),
  status text not null default 'active' check (status in ('active', 'inactive')), is_default boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null, created_by_name text, created_by_email text, created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null, updated_by_name text, updated_by_email text, updated_at timestamptz not null default now()
);
create table if not exists public.procurement_company_letterhead_versions (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete restrict,
  letterhead_id uuid not null references public.procurement_company_letterheads(id) on delete restrict, version_number integer not null check (version_number > 0),
  version_status text not null default 'draft' check (version_status in ('draft', 'ready', 'inactive')),
  header_storage_provider text, header_storage_bucket text, header_storage_key text, header_original_file_name text, header_mime_type text, header_size_bytes bigint, header_width_px integer, header_height_px integer, header_content_hash text,
  footer_storage_provider text, footer_storage_bucket text, footer_storage_key text, footer_original_file_name text, footer_mime_type text, footer_size_bytes bigint, footer_width_px integer, footer_height_px integer, footer_content_hash text,
  page_size text not null default 'A4' check (page_size = 'A4'), header_height_points numeric not null default 150 check (header_height_points >= 0 and header_height_points < 842), footer_height_points numeric not null default 125 check (footer_height_points >= 0 and footer_height_points < 842), content_margin_left_points numeric not null default 42 check (content_margin_left_points >= 0 and content_margin_left_points < 297.5), content_margin_right_points numeric not null default 42 check (content_margin_right_points >= 0 and content_margin_right_points < 297.5), content_gap_after_header_points numeric not null default 8 check (content_gap_after_header_points >= 0), content_gap_before_footer_points numeric not null default 8 check (content_gap_before_footer_points >= 0),
  created_by uuid references public.profiles(id) on delete set null, created_at timestamptz not null default now(), constraint procurement_company_letterhead_versions_uidx unique (letterhead_id, version_number), constraint procurement_company_letterhead_versions_scope_chk check (header_height_points + footer_height_points + content_gap_after_header_points + content_gap_before_footer_points < 842)
);
create unique index if not exists procurement_company_letterheads_default_uidx on public.procurement_company_letterheads(company_id) where is_default and status = 'active';
create index if not exists procurement_company_letterheads_scope_idx on public.procurement_company_letterheads(organization_id, company_id, status);
create index if not exists procurement_company_letterhead_versions_idx on public.procurement_company_letterhead_versions(letterhead_id, version_number desc);
alter table public.procurement_company_letterheads enable row level security;
alter table public.procurement_company_letterhead_versions enable row level security;
revoke all on table public.procurement_company_letterheads, public.procurement_company_letterhead_versions from public, anon, authenticated;
grant all on table public.procurement_company_letterheads, public.procurement_company_letterhead_versions to service_role;
insert into storage.buckets (id, name, public) values ('procurement-company-letterhead-assets', 'procurement-company-letterhead-assets', false) on conflict (id) do nothing;

create or replace function public.make_procurement_company_letterhead_default_atomic(
  p_organization_id uuid, p_company_id uuid, p_letterhead_id uuid, p_actor uuid
) returns void language plpgsql security definer set search_path = public as $$
declare v_target public.procurement_company_letterheads%rowtype; v_ready boolean;
begin
  select * into v_target from public.procurement_company_letterheads
  where id = p_letterhead_id and organization_id = p_organization_id and company_id = p_company_id
  for update;
  if not found then raise exception 'Letterhead is outside the requested scope.'; end if;
  if v_target.status <> 'active' then raise exception 'Only an active Letterhead can be default.'; end if;
  select exists (select 1 from public.procurement_company_letterhead_versions where letterhead_id = p_letterhead_id and version_status = 'ready' and header_storage_key is not null and footer_storage_key is not null and header_content_hash is not null and footer_content_hash is not null) into v_ready;
  if not v_ready then raise exception 'Only a Letterhead with a Ready version can be default.'; end if;
  perform 1 from public.procurement_company_letterheads where organization_id = p_organization_id and company_id = p_company_id for update;
  update public.procurement_company_letterheads set is_default = false, updated_by = p_actor, updated_at = now() where organization_id = p_organization_id and company_id = p_company_id and is_default;
  update public.procurement_company_letterheads set is_default = true, updated_by = p_actor, updated_at = now() where id = p_letterhead_id;
end; $$;
revoke all on function public.make_procurement_company_letterhead_default_atomic(uuid,uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.make_procurement_company_letterhead_default_atomic(uuid,uuid,uuid,uuid) to service_role;
