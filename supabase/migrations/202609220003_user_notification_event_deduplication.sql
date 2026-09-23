begin;

alter table public.user_notifications
  add column if not exists event_key varchar(256);

create unique index if not exists user_notifications_org_recipient_event_key_uidx
  on public.user_notifications (organization_id, recipient_user_id, event_key);

commit;
