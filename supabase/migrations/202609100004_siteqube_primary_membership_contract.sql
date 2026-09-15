-- SiteQube additive primary membership invariant.
-- Draft only: apply before enabling managed invitation acceptance.
begin;

create unique index if not exists organization_memberships_one_active_primary_idx
  on public.organization_memberships (user_id)
  where membership_status = 'active' and is_primary = true;

commit;
