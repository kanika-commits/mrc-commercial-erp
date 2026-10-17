-- Per-recipient dismissal for notification lifecycle handling.
alter table public.user_notifications add column if not exists dismissed_at timestamptz;
create index if not exists user_notifications_recipient_active_created_idx on public.user_notifications (recipient_user_id, dismissed_at, created_at desc);
