begin;

create or replace function public.delete_work_order_atomic(
  p_work_order_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_work_order public.work_orders%rowtype;
begin
  if p_work_order_id is null then
    raise exception using message = 'INVALID_REQUEST';
  end if;

  select * into v_work_order
  from public.work_orders
  where id = p_work_order_id
  for update;

  if not found then
    raise exception using message = 'NOT_FOUND';
  end if;

  delete from public.work_order_items where work_order_id = p_work_order_id;
  delete from public.work_order_documents where work_order_id = p_work_order_id;
  delete from public.work_order_vendors where work_order_id = p_work_order_id;
  delete from public.work_order_files where work_order_id = p_work_order_id;
  delete from public.work_order_changes where work_order_id = p_work_order_id;
  delete from public.work_order_drive_folders where work_order_id = p_work_order_id;
  delete from public.work_orders where id = p_work_order_id;

  return to_jsonb(v_work_order);
end;
$$;

revoke all on function public.delete_work_order_atomic(uuid)
  from public, anon, authenticated;
grant execute on function public.delete_work_order_atomic(uuid)
  to service_role;

commit;
