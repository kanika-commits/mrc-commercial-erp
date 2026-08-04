do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'erp_audit_logs_action_check'
      and conrelid = 'public.erp_audit_logs'::regclass
  ) then
    alter table public.erp_audit_logs
      drop constraint erp_audit_logs_action_check;
  end if;

  alter table public.erp_audit_logs
    add constraint erp_audit_logs_action_check
    check (
      action in (
        'create',
        'update',
        'delete',
        'restore',
        'import',
        'export',
        'upload',
        'download',
        'approve',
        'reject',
        'login',
        'logout',
        'password_change',
        'permission_change',
        'salary_revision',
        'employment_change',
        'document_upload',
        'document_replace',
        'document_delete',
        'photo_upload',
        'photo_replace',
        'erp_profile_linked',
        'erp_profile_unlinked',
        'erp_profile_changed',
        'manual_event',
        'other'
      )
    ) not valid;
end $$;
