begin;

create unique index if not exists user_notifications_work_order_submission_identity_idx
  on public.user_notifications (
    organization_id,
    recipient_user_id,
    notification_type,
    related_entity_type,
    related_entity_id
  )
  where notification_type = 'work_order_submitted_for_approval'
    and related_entity_type = 'work_order';

commit;
