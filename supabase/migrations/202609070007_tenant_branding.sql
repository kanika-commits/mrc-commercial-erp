begin;

create table if not exists public.organization_branding (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id) on delete cascade,
  organization_name text not null,
  logo_path text,
  primary_color text check (primary_color is null or primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  secondary_color text check (secondary_color is null or secondary_color ~ '^#[0-9A-Fa-f]{6}$'),
  login_tagline text,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists organization_branding_organization_id_idx
  on public.organization_branding(organization_id);

alter table public.organization_branding enable row level security;

insert into storage.buckets (id, name, public)
values ('tenant-branding-assets', 'tenant-branding-assets', false)
on conflict (id) do nothing;

commit;
