begin;

create table if not exists public.procurement_purchase_order_artifacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  purchase_order_id uuid not null references public.procurement_purchase_orders(id) on delete restrict,
  artifact_type text not null default 'official_po',
  artifact_status text not null default 'pending',
  archive_origin text not null default 'approval',
  storage_provider text not null default 'supabase',
  storage_bucket text not null,
  storage_key text not null,
  sha256 text,
  size_bytes bigint,
  page_count integer,
  footer_rendered_height numeric,
  generated_by uuid,
  generated_at timestamptz,
  archived_at timestamptz,
  attempt_token uuid,
  attempt_started_at timestamptz,
  failure_message text,
  created_at timestamptz not null default now(),
  constraint procurement_purchase_order_artifacts_type_check check (artifact_type = 'official_po'),
  constraint procurement_purchase_order_artifacts_status_check check (artifact_status in ('pending', 'archiving', 'archived', 'failed')),
  constraint procurement_purchase_order_artifacts_origin_check check (archive_origin in ('approval', 'reconstruction')),
  constraint procurement_purchase_order_artifacts_provider_check check (storage_provider = 'supabase'),
  constraint procurement_purchase_order_artifacts_hash_check check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  constraint procurement_purchase_order_artifacts_size_check check (size_bytes is null or size_bytes >= 0),
  constraint procurement_purchase_order_artifacts_page_check check (page_count is null or page_count > 0),
  constraint procurement_purchase_order_artifacts_unique_po_type unique (organization_id, purchase_order_id, artifact_type),
  constraint procurement_purchase_order_artifacts_unique_object unique (storage_bucket, storage_key),
  constraint procurement_purchase_order_artifacts_archived_metadata check (
    artifact_status <> 'archived' or (sha256 is not null and size_bytes is not null and page_count is not null and generated_at is not null and archived_at is not null)
  )
);

create index if not exists procurement_purchase_order_artifacts_org_status_idx
  on public.procurement_purchase_order_artifacts (organization_id, artifact_status, created_at desc);
create index if not exists procurement_purchase_order_artifacts_po_idx
  on public.procurement_purchase_order_artifacts (purchase_order_id);

-- Persist the feature-enable boundary so scoped retry can distinguish legacy
-- approvals from approvals created after this archive workflow was deployed.
create table if not exists public.procurement_purchase_order_artifact_archive_config (
  singleton boolean primary key default true check (singleton),
  feature_enabled_at timestamptz not null default clock_timestamp()
);
insert into public.procurement_purchase_order_artifact_archive_config (singleton)
values (true)
on conflict (singleton) do nothing;

alter table public.procurement_purchase_order_artifact_archive_config enable row level security;
revoke all on table public.procurement_purchase_order_artifact_archive_config from public, anon, authenticated;
grant select on table public.procurement_purchase_order_artifact_archive_config to service_role;

alter table public.procurement_purchase_order_artifacts enable row level security;
revoke all on table public.procurement_purchase_order_artifacts from public, anon, authenticated;
grant all on table public.procurement_purchase_order_artifacts to service_role;

create or replace function public.guard_procurement_purchase_order_artifact_immutability()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.artifact_status = 'archived' then
    raise exception 'Archived official Purchase Order artifacts are immutable.';
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Official Purchase Order artifact records cannot be deleted.';
  end if;
  return new;
end;
$$;

drop trigger if exists procurement_purchase_order_artifact_immutable on public.procurement_purchase_order_artifacts;
create trigger procurement_purchase_order_artifact_immutable
before update or delete on public.procurement_purchase_order_artifacts
for each row execute function public.guard_procurement_purchase_order_artifact_immutability();

revoke all on function public.guard_procurement_purchase_order_artifact_immutability() from public, anon, authenticated;
grant execute on function public.guard_procurement_purchase_order_artifact_immutability() to service_role;

commit;
