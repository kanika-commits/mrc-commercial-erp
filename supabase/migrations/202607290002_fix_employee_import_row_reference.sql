create or replace function public.execute_employee_import_row(
  p_batch_id uuid,
  p_row_id uuid,
  p_actor_user_id uuid,
  p_actor_name text,
  p_actor_email text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch public.employee_import_batches%rowtype;
  v_row public.employee_import_rows%rowtype;
  v_employee public.hr_employees%rowtype;
  v_existing_employee_id uuid;
  v_normalized jsonb;
  v_today date := current_date;
  v_joining_date date;
  v_has_salary boolean := false;
  v_joining_salary numeric;
  v_joining_net_salary numeric;
  v_current_gross_salary numeric;
  v_current_net_salary numeric;
  v_has_joining_salary boolean := false;
  v_has_distinct_current_salary boolean := false;
  v_result jsonb;
  v_error text;
begin
  select * into v_batch
  from public.employee_import_batches
  where id = p_batch_id
  for update;

  if not found then
    raise exception 'Import batch was not found.';
  end if;

  select * into v_row
  from public.employee_import_rows
  where id = p_row_id
    and batch_id = p_batch_id
  for update;

  if not found then
    raise exception 'Import row was not found.';
  end if;

  if v_row.import_status <> 'pending' then
    return jsonb_build_object(
      'status', v_row.import_status,
      'employeeId', v_row.imported_employee_id,
      'message', 'Row was already processed.'
    );
  end if;

  if v_row.validation_status = 'invalid' then
    raise exception 'Invalid rows cannot be imported.';
  end if;

  v_normalized := coalesce(v_row.normalized_data, '{}'::jsonb);

  begin
    select id into v_existing_employee_id
    from public.hr_employees
    where organization_id = v_row.organization_id
      and lower(trim(employee_code)) = lower(trim(v_normalized->>'employee_code'))
      and coalesce(status, '') <> 'deleted'
    limit 1;

    if v_existing_employee_id is not null then
      v_result := jsonb_build_object(
        'status', 'skipped',
        'employeeId', v_existing_employee_id,
        'message', 'Employee code already exists; row skipped idempotently.'
      );

      update public.employee_import_rows
      set import_status = 'skipped',
          imported_employee_id = v_existing_employee_id,
          import_result = v_result,
          imported_at = now(),
          updated_at = now()
      where id = p_row_id;

      return v_result;
    end if;

    v_joining_date := coalesce(nullif(v_normalized->>'date_of_joining', '')::date, v_today);

    insert into public.hr_employees (
      organization_id,
      company_id,
      site_id,
      department_id,
      designation_id,
      employee_code,
      employee_name,
      email,
      phone,
      personal_email,
      personal_phone,
      date_of_birth,
      gender,
      blood_group,
      marital_status,
      current_address,
      permanent_address,
      current_address_line1,
      current_address_city,
      permanent_address_line1,
      permanent_address_city,
      father_name,
      mother_name,
      spouse_name,
      emergency_contact_name,
      emergency_contact_phone,
      date_of_joining,
      employment_type,
      shift,
      confirmation_date,
      notice_period_from,
      notice_period_to,
      resignation_date,
      date_of_exit,
      exit_remark,
      remarks,
      status,
      created_by,
      created_by_name,
      created_by_email
    )
    values (
      v_row.organization_id,
      v_row.matched_company_id,
      v_row.matched_site_id,
      v_row.matched_department_id,
      v_row.matched_designation_id,
      nullif(v_normalized->>'employee_code', ''),
      nullif(v_normalized->>'employee_name', ''),
      nullif(v_normalized->>'email', ''),
      nullif(v_normalized->>'phone', ''),
      nullif(v_normalized->>'personal_email', ''),
      nullif(v_normalized->>'personal_phone', ''),
      nullif(v_normalized->>'date_of_birth', '')::date,
      nullif(v_normalized->>'gender', ''),
      nullif(v_normalized->>'blood_group', ''),
      nullif(v_normalized->>'marital_status', ''),
      nullif(v_normalized->>'current_address', ''),
      nullif(v_normalized->>'permanent_address', ''),
      nullif(v_normalized->>'current_address_line1', ''),
      nullif(v_normalized->>'current_address_city', ''),
      nullif(v_normalized->>'permanent_address_line1', ''),
      nullif(v_normalized->>'permanent_address_city', ''),
      nullif(v_normalized->>'father_name', ''),
      nullif(v_normalized->>'mother_name', ''),
      nullif(v_normalized->>'spouse_name', ''),
      null,
      null,
      v_joining_date,
      coalesce(nullif(v_normalized->>'employment_type', ''), 'full_time'),
      nullif(v_normalized->>'shift', ''),
      nullif(v_normalized->>'confirmation_date', '')::date,
      nullif(v_normalized->>'notice_period_from', '')::date,
      nullif(v_normalized->>'notice_period_to', '')::date,
      nullif(v_normalized->>'resignation_date', '')::date,
      nullif(v_normalized->>'date_of_exit', '')::date,
      nullif(v_normalized->>'exit_remark', ''),
      nullif(v_normalized->>'remarks', ''),
      coalesce(nullif(v_normalized->>'status', ''), 'active'),
      p_actor_user_id,
      p_actor_name,
      p_actor_email
    )
    returning * into v_employee;

    if to_regclass('public.employee_employment_history') is not null then
      execute '
        insert into public.employee_employment_history (
          organization_id, employee_id, event_type, event_date, effective_from, title,
          description, source, is_manual, previous_values, new_values, company_id, site_id,
          department_id, designation_id, employment_type, shift, employment_status,
          source_system, source_record_id, import_batch_id, created_by, created_by_name, created_by_email
        )
        values ($1,$2,''joined'',$3,$3,''Joined'',''Initial employment record created from Head Office import.'',
          ''import'',false,null,$4,$5,$6,$7,$8,$9,$10,$11,''head_office_workbook'',$12,$13,$14,$15,$16)'
      using v_employee.organization_id, v_employee.id, v_joining_date, to_jsonb(v_employee),
        v_employee.company_id, v_employee.site_id, v_employee.department_id, v_employee.designation_id,
        v_employee.employment_type, v_employee.shift, v_employee.status, p_batch_id::text || ':' || v_row.source_row_number::text,
        p_batch_id, p_actor_user_id, p_actor_name, p_actor_email;
    end if;

    v_joining_salary := case
      when lower(trim(coalesce(v_normalized->>'joining_salary', ''))) in ('', '''', '’', '0', '0.0', '0.00', '-', 'na', 'n/a', 'nil', 'none', 'null', 'not available') then null
      else (v_normalized->>'joining_salary')::numeric
    end;
    v_joining_net_salary := case
      when lower(trim(coalesce(v_normalized->>'joining_net_salary', ''))) in ('', '''', '’', '0', '0.0', '0.00', '-', 'na', 'n/a', 'nil', 'none', 'null', 'not available') then null
      else (v_normalized->>'joining_net_salary')::numeric
    end;
    v_current_gross_salary := case
      when lower(trim(coalesce(v_normalized->>'gross_salary', ''))) in ('', '''', '’', '0', '0.0', '0.00', '-', 'na', 'n/a', 'nil', 'none', 'null', 'not available') then null
      else (v_normalized->>'gross_salary')::numeric
    end;
    v_current_net_salary := case
      when lower(trim(coalesce(v_normalized->>'net_salary', ''))) in ('', '''', '’', '0', '0.0', '0.00', '-', 'na', 'n/a', 'nil', 'none', 'null', 'not available') then null
      else (v_normalized->>'net_salary')::numeric
    end;

    v_has_salary :=
      coalesce(v_joining_salary, 0) > 0 or
      coalesce(v_joining_net_salary, 0) > 0 or
      coalesce(v_current_gross_salary, 0) > 0 or
      coalesce(v_current_net_salary, 0) > 0;
    v_has_joining_salary := coalesce(v_joining_salary, 0) > 0 or coalesce(v_joining_net_salary, 0) > 0;
    v_has_distinct_current_salary :=
      (coalesce(v_current_gross_salary, 0) > 0 or coalesce(v_current_net_salary, 0) > 0)
      and not (
        v_has_joining_salary
        and v_joining_salary is not distinct from v_current_gross_salary
        and v_joining_net_salary is not distinct from v_current_net_salary
        and coalesce(nullif(v_normalized->>'current_salary_effective_date', '')::date, v_joining_date)
          = coalesce(nullif(v_normalized->>'joining_salary_effective_date', '')::date, v_joining_date)
      );

    if v_has_salary and to_regclass('public.employee_salary_history') is not null then
      if v_has_joining_salary then
        execute '
          insert into public.employee_salary_history (
            organization_id, employee_id, revision_no, revision_type, effective_from, effective_to,
            basic_salary, gross_salary, net_salary, source, source_system, source_record_id,
            import_batch_id, status, previous_values, new_values, created_by, created_by_name, created_by_email
          )
          values ($1,$2,1,''joining_salary'',$3,null,$4,$4,$5,''import'',''head_office_workbook'',$6,$7,$12,null,$8,$9,$10,$11)
          on conflict do nothing'
        using v_employee.organization_id, v_employee.id,
          coalesce(nullif(v_normalized->>'joining_salary_effective_date', '')::date, v_joining_date),
          v_joining_salary,
          v_joining_net_salary,
          v_row.source_row_number::text, p_batch_id,
          jsonb_build_object('joining_salary', v_joining_salary, 'joining_net_salary', v_joining_net_salary),
          p_actor_user_id, p_actor_name, p_actor_email,
          case when v_has_distinct_current_salary then 'historical' else 'current' end;
      end if;

      if v_has_distinct_current_salary then
        execute '
          insert into public.employee_salary_history (
            organization_id, employee_id, revision_no, revision_type, effective_from, effective_to,
            basic_salary, gross_salary, net_salary, source, source_system, source_record_id,
            import_batch_id, status, previous_values, new_values, created_by, created_by_name, created_by_email
          )
          values ($1,$2,$12,$13,$3,null,$4,$4,$5,''import'',''head_office_workbook'',$6,$7,''current'',null,$8,$9,$10,$11)
          on conflict do nothing'
        using v_employee.organization_id, v_employee.id,
          coalesce(nullif(v_normalized->>'current_salary_effective_date', '')::date, v_joining_date),
          v_current_gross_salary,
          v_current_net_salary,
          v_row.source_row_number::text, p_batch_id,
          jsonb_build_object('gross_salary', v_current_gross_salary, 'net_salary', v_current_net_salary),
          p_actor_user_id, p_actor_name, p_actor_email,
          case when v_has_joining_salary then 2 else 1 end,
          case when v_has_joining_salary then 'salary_correction' else 'joining_salary' end;
      end if;
    end if;

    insert into public.employee_compliance_records (
      organization_id, employee_id, import_batch_id, import_row_id, record_type,
      record_number, record_name, metadata, source, status, created_by, created_by_name, created_by_email
    )
    select v_employee.organization_id, v_employee.id, p_batch_id, p_row_id, item.record_type,
      item.record_number, item.record_type,
      jsonb_build_object('source', 'head_office_workbook'), 'import', 'active',
      p_actor_user_id, p_actor_name, p_actor_email
    from (
      values
        ('PAN', nullif(v_normalized->>'pan_number', '')),
        ('Aadhaar', nullif(v_normalized->>'aadhaar_number', '')),
        ('Passport', nullif(v_normalized->>'passport_number', '')),
        ('Driving Licence', nullif(v_normalized->>'driving_license_number', '')),
        ('Voter ID', nullif(v_normalized->>'voter_id', '')),
        ('UAN', nullif(v_normalized->>'uan_number', '')),
        ('ESI', nullif(v_normalized->>'esi_number', '')),
        ('PF', nullif(v_normalized->>'pf_number', '')),
        ('Bank Account', nullif(v_normalized->>'bank_account_number', ''))
    ) as item(record_type, record_number)
    where item.record_number is not null
      and lower(trim(item.record_number)) not in ('', '''', '’', '0', '-', 'na', 'n/a', 'nil', 'none', 'null', 'not available')
    on conflict do nothing;

    if to_regclass('public.erp_audit_logs') is not null then
      execute '
        insert into public.erp_audit_logs (
          organization_id, company_id, site_id, module_code, entity_type, record_id, action,
          description, old_values, new_values, source, import_batch_id,
          created_by, created_by_name, created_by_email
        )
        values ($1,$2,$3,''hr_employee_import'',''hr_employee'',$4,''import'',$5,null,$6,''import'',$7,$8,$9,$10)'
      using v_employee.organization_id, v_employee.company_id, v_employee.site_id, v_employee.id,
        'Employee ' || v_employee.employee_name || ' imported from Head Office workbook.',
        to_jsonb(v_employee), p_batch_id, p_actor_user_id, p_actor_name, p_actor_email;
    end if;

    v_result := jsonb_build_object(
      'status', 'imported',
      'employeeId', v_employee.id,
      'message', 'Employee imported.'
    );

    update public.employee_import_rows
    set import_status = 'imported',
        imported_employee_id = v_employee.id,
        import_result = v_result,
        imported_at = now(),
        updated_at = now()
    where id = p_row_id;

    return v_result;
  exception when others then
    v_error := sqlerrm;
    update public.employee_import_rows
    set import_status = 'failed',
        import_result = jsonb_build_object('status', 'failed', 'message', v_error),
        errors = coalesce(errors, '[]'::jsonb) || to_jsonb(v_error),
        updated_at = now()
    where id = p_row_id;

    return jsonb_build_object('status', 'failed', 'message', v_error);
  end;
end;
$$;
