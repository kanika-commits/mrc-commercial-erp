alter table public.procurement_purchase_order_sequences enable row level security;
alter table public.procurement_purchase_orders enable row level security;
alter table public.procurement_purchase_order_items enable row level security;
alter table public.procurement_purchase_order_events enable row level security;
alter table public.procurement_purchase_order_documents enable row level security;

revoke all on table public.procurement_purchase_order_sequences, public.procurement_purchase_orders, public.procurement_purchase_order_items, public.procurement_purchase_order_events, public.procurement_purchase_order_documents from public, anon, authenticated;
grant all on table public.procurement_purchase_order_sequences, public.procurement_purchase_orders, public.procurement_purchase_order_items, public.procurement_purchase_order_events, public.procurement_purchase_order_documents to service_role;

revoke all on function public.next_procurement_purchase_order_number(uuid, date) from public, anon, authenticated;
revoke all on function public.create_procurement_purchase_order_draft_atomic(text, uuid, uuid, uuid, uuid, jsonb, uuid, text, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.create_procurement_purchase_order_draft_idempotent_atomic(text, uuid, uuid, uuid, uuid, jsonb, uuid, text, jsonb, jsonb, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.resolve_procurement_po_master_snapshot(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.update_procurement_purchase_order_draft_atomic(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.update_procurement_purchase_order_draft_with_additional_charges(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.update_procurement_po_draft_with_additional_charges_atomic(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.set_procurement_purchase_order_freight_atomic(uuid, uuid, numeric, jsonb) from public, anon, authenticated;
revoke all on function public.transition_procurement_purchase_order_atomic(uuid, uuid, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.add_procurement_purchase_order_document_atomic(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.remove_procurement_purchase_order_document_atomic(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.reorder_procurement_purchase_order_documents_atomic(uuid, uuid, uuid[]) from public, anon, authenticated;

grant execute on function public.next_procurement_purchase_order_number(uuid, date) to service_role;
grant execute on function public.create_procurement_purchase_order_draft_atomic(text, uuid, uuid, uuid, uuid, jsonb, uuid, text, jsonb, jsonb, jsonb) to service_role;
grant execute on function public.create_procurement_purchase_order_draft_idempotent_atomic(text, uuid, uuid, uuid, uuid, jsonb, uuid, text, jsonb, jsonb, jsonb, uuid) to service_role;
grant execute on function public.resolve_procurement_po_master_snapshot(uuid, uuid, uuid, jsonb) to service_role;
grant execute on function public.update_procurement_purchase_order_draft_atomic(uuid, uuid, jsonb, jsonb) to service_role;
grant execute on function public.update_procurement_purchase_order_draft_with_additional_charges(uuid, uuid, jsonb, jsonb) to service_role;
grant execute on function public.update_procurement_po_draft_with_additional_charges_atomic(uuid, uuid, jsonb, jsonb) to service_role;
grant execute on function public.set_procurement_purchase_order_freight_atomic(uuid, uuid, numeric, jsonb) to service_role;
grant execute on function public.transition_procurement_purchase_order_atomic(uuid, uuid, text, jsonb, text) to service_role;
grant execute on function public.add_procurement_purchase_order_document_atomic(uuid, uuid, jsonb) to service_role;
grant execute on function public.remove_procurement_purchase_order_document_atomic(uuid, uuid, uuid) to service_role;
grant execute on function public.reorder_procurement_purchase_order_documents_atomic(uuid, uuid, uuid[]) to service_role;
