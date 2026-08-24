begin;

create or replace function public.bulk_hard_delete_labour_workers_atomic(
  p_worker_ids uuid[],
  p_actor_id uuid,
  p_actor_name text,
  p_actor_email text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_worker_id uuid;
  v_worker_ids uuid[] := (select array_agg(distinct id order by id) from unnest(p_worker_ids) id);
  v_deployment_ids uuid[];
  v_worker_deployment_ids uuid[];
  v_worker_snapshot jsonb := '[]'::jsonb;
  v_deployment_snapshot jsonb := '[]'::jsonb;
  v_audit_id uuid;
  v_reason text := nullif(btrim(p_reason), '');
  v_count bigint;
  v_deployment_count bigint;
  v_expected_deployments bigint;
  v_deployments_deleted bigint;
  v_remaining_count bigint;
begin
  if coalesce(cardinality(v_worker_ids), 0) = 0 then raise exception 'At least one labour worker is required.'; end if;
  if cardinality(v_worker_ids) > 200 then raise exception 'Bulk hard delete supports a maximum of 200 workers at a time.'; end if;
  if p_actor_id is null or nullif(btrim(p_actor_name), '') is null or nullif(btrim(p_actor_email), '') is null then raise exception 'A truthful deletion actor is required.'; end if;
  if v_reason is null then raise exception 'Deletion reason is required.'; end if;

  perform pg_advisory_xact_lock(hashtextextended(array_to_string(v_worker_ids, ','), 0));

  select count(*) into v_count from public.labour_workers where id = any(v_worker_ids);
  if v_count <> cardinality(v_worker_ids) then raise exception 'Hard delete blocked: one or more workers were not found.'; end if;

  perform 1 from public.labour_workers where id = any(v_worker_ids) for update;

  v_expected_deployments := 0;

  for v_worker_id in select unnest(v_worker_ids) loop
    select array_agg(d.id order by d.id), count(*)
    into v_worker_deployment_ids, v_deployment_count
    from public.labour_deployments d
    where d.labour_worker_id = v_worker_id;

    v_expected_deployments := v_expected_deployments + v_deployment_count;
    v_deployment_ids := coalesce(v_deployment_ids, '{}'::uuid[]) || coalesce(v_worker_deployment_ids, '{}'::uuid[]);
    perform 1 from public.labour_deployments where labour_worker_id = v_worker_id for update;

    if v_deployment_count <> 1 then raise exception 'Hard delete blocked: worker % must have exactly one deployment.', v_worker_id; end if;
    if exists (select 1 from public.labour_attendance where labour_worker_id = v_worker_id or deployment_id = any(coalesce(v_worker_deployment_ids, '{}'::uuid[]))) then raise exception 'Hard delete blocked: attendance exists for worker %.', v_worker_id; end if;
    if exists (select 1 from public.labour_attendance_import_rows where matched_labour_worker_id = v_worker_id or matched_deployment_id = any(coalesce(v_worker_deployment_ids, '{}'::uuid[]))) then raise exception 'Hard delete blocked: attendance-import data exists for worker %.', v_worker_id; end if;
    if exists (select 1 from public.labour_attendance_submission_version_rows where labour_worker_id = v_worker_id or deployment_id = any(coalesce(v_worker_deployment_ids, '{}'::uuid[]))) then raise exception 'Hard delete blocked: attendance snapshot exists for worker %.', v_worker_id; end if;
    if exists (select 1 from public.labour_site_in_engineer_assignments where labour_worker_id = v_worker_id or deployment_id = any(coalesce(v_worker_deployment_ids, '{}'::uuid[]))) then raise exception 'Hard delete blocked: engineer Site-In assignment exists for worker %.', v_worker_id; end if;
    if exists (select 1 from public.labour_site_ins where labour_worker_id = v_worker_id or deployment_id = any(coalesce(v_worker_deployment_ids, '{}'::uuid[]))) then raise exception 'Hard delete blocked: Site-In exists for worker %.', v_worker_id; end if;
    if exists (select 1 from public.labour_wage_lines where labour_worker_id = v_worker_id or deployment_id = any(coalesce(v_worker_deployment_ids, '{}'::uuid[]))) then raise exception 'Hard delete blocked: wage/payroll data exists for worker %.', v_worker_id; end if;
    if exists (select 1 from public.labour_wage_rates where labour_worker_id = v_worker_id or deployment_id = any(coalesce(v_worker_deployment_ids, '{}'::uuid[]))) then raise exception 'Hard delete blocked: wage-rate data exists for worker %.', v_worker_id; end if;
    if exists (select 1 from public.labour_work_group_members where labour_worker_id = v_worker_id or deployment_id = any(coalesce(v_worker_deployment_ids, '{}'::uuid[]))) then raise exception 'Hard delete blocked: work-group membership exists for worker %.', v_worker_id; end if;
    if exists (select 1 from public.labour_worker_rate_overrides where labour_worker_id = v_worker_id or deployment_id = any(coalesce(v_worker_deployment_ids, '{}'::uuid[]))) then raise exception 'Hard delete blocked: rate override exists for worker %.', v_worker_id; end if;
    if exists (select 1 from public.labour_advances where labour_worker_id = v_worker_id and status <> 'deleted') then raise exception 'Hard delete blocked: advance exists for worker %.', v_worker_id; end if;
    if exists (select 1 from public.labour_documents where labour_worker_id = v_worker_id) then raise exception 'Hard delete blocked: document exists for worker %.', v_worker_id; end if;
    if exists (select 1 from public.labour_overtime_requests where labour_worker_id = v_worker_id) then raise exception 'Hard delete blocked: overtime request exists for worker %.', v_worker_id; end if;
    if exists (select 1 from public.labour_import_rows where created_labour_worker_id = v_worker_id or matched_labour_worker_id = v_worker_id) then raise exception 'Hard delete blocked: import reference exists for worker %.', v_worker_id; end if;
    v_worker_snapshot := v_worker_snapshot || coalesce((select jsonb_agg(to_jsonb(w)) from public.labour_workers w where w.id = v_worker_id), '[]'::jsonb);
    v_deployment_snapshot := v_deployment_snapshot || coalesce((select jsonb_agg(to_jsonb(d)) from public.labour_deployments d where d.labour_worker_id = v_worker_id), '[]'::jsonb);
  end loop;

  insert into public.erp_audit_logs (organization_id, module_code, entity_type, action, description, new_values, source, created_by, created_by_name, created_by_email)
  select min(w.organization_id), 'labour_workers', 'labour_worker', 'manual_event', 'labour_bulk_hard_delete',
    jsonb_build_object('event','labour_bulk_hard_delete','worker_count',cardinality(v_worker_ids),'worker_ids',to_jsonb(v_worker_ids),'workers',v_worker_snapshot,'deployments',v_deployment_snapshot,'reason',v_reason,'deleted_at',now()),
    'manual', p_actor_id, p_actor_name, p_actor_email
  from public.labour_workers w where w.id = any(v_worker_ids)
  returning id into v_audit_id;

  delete from public.labour_deployments where labour_worker_id = any(v_worker_ids);
  get diagnostics v_deployments_deleted = row_count;
  if v_deployments_deleted <> v_expected_deployments then raise exception 'Hard delete failed: deployment count mismatch.'; end if;
  select count(*) into v_remaining_count from public.labour_deployments where id = any(coalesce(v_deployment_ids, '{}'::uuid[]));
  if v_remaining_count <> 0 then raise exception 'Hard delete failed: target deployments remain.'; end if;
  delete from public.labour_workers where id = any(v_worker_ids);
  get diagnostics v_count = row_count;
  if v_count <> cardinality(v_worker_ids) then raise exception 'Hard delete failed: worker count mismatch.'; end if;
  select count(*) into v_remaining_count from public.labour_workers where id = any(v_worker_ids);
  if v_remaining_count <> 0 then raise exception 'Hard delete failed: target workers remain.'; end if;

  return jsonb_build_object('result','deleted','workers_deleted',v_count,'deployments_deleted',v_deployments_deleted,'audit_log_id',v_audit_id);
end;
$$;

revoke execute on function public.bulk_hard_delete_labour_workers_atomic(uuid[], uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.bulk_hard_delete_labour_workers_atomic(uuid[], uuid, text, text, text) to service_role;

commit;
