begin;

create or replace function public.inactivate_labour_worker_atomic(
  p_worker_id uuid,
  p_organization_id uuid,
  p_effective_date date,
  p_reason text,
  p_actor_id uuid,
  p_actor_name text,
  p_actor_email text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_worker public.labour_workers%rowtype;
  v_closed integer := 0;
  v_effective_to date;
begin
  if p_worker_id is null or p_organization_id is null or p_effective_date is null then
    raise exception 'Worker, organization and effective date are required.';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'Inactivation reason is required.';
  end if;

  select * into v_worker
    from public.labour_workers
   where id = p_worker_id
     and organization_id = p_organization_id
   for update;
  if not found then raise exception 'Labourer not found.'; end if;
  if v_worker.status <> 'active' then raise exception 'Only active labourers can be marked inactive.'; end if;

  update public.labour_deployments
     set status = 'ended',
         effective_to = greatest(coalesce(effective_from, p_effective_date), p_effective_date - 1),
         deployment_reason = p_reason,
         updated_at = clock_timestamp(),
         updated_by = p_actor_id,
         updated_by_name = p_actor_name,
         updated_by_email = p_actor_email
   where labour_worker_id = p_worker_id
     and organization_id = p_organization_id
     and status = 'active'
     and effective_to is null;
  get diagnostics v_closed = row_count;

  update public.labour_workers
     set status = 'inactive', updated_at = clock_timestamp(),
         updated_by = p_actor_id, updated_by_name = p_actor_name, updated_by_email = p_actor_email
   where id = p_worker_id and organization_id = p_organization_id and status = 'active';

  return jsonb_build_object(
    'labour_worker_id', p_worker_id,
    'status', 'inactive',
    'effective_date', p_effective_date,
    'closed_deployments', v_closed
  );
end;
$$;

revoke all on function public.inactivate_labour_worker_atomic(uuid, uuid, date, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.inactivate_labour_worker_atomic(uuid, uuid, date, text, uuid, text, text) to service_role;

commit;
