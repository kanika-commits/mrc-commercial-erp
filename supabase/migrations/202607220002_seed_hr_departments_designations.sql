begin;

with source_departments(department_name, department_code) as (
  values
    ('ACCOUNT DEPARTMENT', 'ACC'),
    ('ACCOUNTS DEPARTMENT', 'AD'),
    ('ADMINISTRATION', 'ADMIN'),
    ('CIVIL DEPARTMENT', 'CD'),
    ('CONTRACTUAL MUSTER', 'CONTRACTUAL'),
    ('COOK', 'COOK'),
    ('DRIVER', 'DRIVER'),
    ('ELECTRICAL DEPARTMENT', 'ED'),
    ('ERP DEPARTMENT', 'ERP'),
    ('GENERAL', 'GENERAL'),
    ('HUMAN RESOURCE MANAGEMENT', 'HRM'),
    ('MANAGEMENT', 'MAN'),
    ('MECHANICAL DEPARTMENT', 'MEC'),
    ('MUSTER', 'MUSTER'),
    ('OFFICE', 'OFF'),
    ('OPERATIONS & ADMIN', 'OP'),
    ('PLANT AND MACHINERY', 'P&M'),
    ('PURCHASE DEPARTMENT', 'PD'),
    ('QA/QC DEPARTMENT', 'QA/QC'),
    ('SALES', 'SALES'),
    ('SECURITY DEPARTMENT', 'SEC'),
    ('STORE', 'STORE')
),
normalized_departments as (
  select
    department_name,
    department_code,
    upper(regexp_replace(btrim(department_name), '[[:space:]]+', ' ', 'g')) as normalized_name
  from source_departments
),
organization_departments as (
  select
    organizations.id as organization_id,
    source.department_name,
    source.department_code,
    source.normalized_name
  from public.organizations
  cross join normalized_departments source
)
insert into public.hr_departments (
  organization_id,
  department_name,
  department_code,
  status,
  created_at
)
select
  source.organization_id,
  source.department_name,
  source.department_code,
  'active',
  now()
from organization_departments source
where not exists (
  select 1
  from public.hr_departments existing
  where existing.organization_id = source.organization_id
    and upper(regexp_replace(btrim(existing.department_name), '[[:space:]]+', ' ', 'g')) = source.normalized_name
);

with source_designations(designation_name, designation_code) as (
  values
    ('ACCOUNTANT', 'ACC'),
    ('ASST. MANAGER', 'ASS MNGR'),
    ('BILLING ENGINEER', 'BE'),
    ('CHARTERED ACCOUNTANT', 'CA'),
    ('COMPANY SECRETARY', 'CS'),
    ('COMPUTER OPERATOR', 'CO'),
    ('CONCRETE PLANT OPERATOR', 'CPO'),
    ('CONCRETE PUMP OPERATOR', 'CON'),
    ('CONTRACTUAL LABOUR', 'CL'),
    ('COOK', 'COOK'),
    ('COOK HELPER', 'COOK'),
    ('COOLIE', 'COOLIE'),
    ('CRANE OPERATOR', 'CO'),
    ('DATA ENTRY OPERATOR', 'DEOP'),
    ('DEPUTY PROJECT MANAGER', 'DPM'),
    ('DIRECTOR', 'DIR'),
    ('DRIVER', 'DRIVER'),
    ('ELECTRICAL AND MECHANICAL ENGINEER', 'EME'),
    ('ELECTRICAL ENGINEER', 'EE'),
    ('ELECTRICAL MANAGER', 'ELEC MGR'),
    ('ELECTRICIAN', 'ELE'),
    ('ENGINEER', 'ENG'),
    ('ERP EXECUTIVE', 'ERP'),
    ('ERP MANAGER', 'ERP'),
    ('FOREMAN', 'FOREMAN'),
    ('HR ASS MANAGER', 'HR'),
    ('HR MANAGER', 'HR'),
    ('JCB OPERATOR', 'JCB'),
    ('LAB INCHARGE', 'LAB'),
    ('LABOUR', 'LAB'),
    ('MANAGER', 'MANAGER'),
    ('MASON', 'MAS'),
    ('MECHANICAL, ELECTRICAL, AND PLUMBING ENGINEER', 'MEP'),
    ('MECHANICAL ENGINEER', 'MEC'),
    ('OFFICE BOY', 'OFF'),
    ('PLANNING AND BILLING', 'P&B'),
    ('PLANT OPERATOR', 'PLA'),
    ('PLUMBER', 'PLU'),
    ('PROJECT MANAGER', 'PRO'),
    ('PROJECT PLANNING', 'PP'),
    ('PUMP OPERATOR', 'PUM'),
    ('QUALITY ENGINEER', 'QE'),
    ('QUOTATION COMPARISON', 'QC'),
    ('SAFETY ASSISTANT', 'SAF'),
    ('SECURITY GUARD', 'SEC'),
    ('SECURITY OFFICER', 'SO'),
    ('SENIOR ENGINEER', 'SEN'),
    ('SITE ENGINEER', 'SE'),
    ('SITE ENGINEER TRAINEE', 'SET'),
    ('SITE SUPERVISOR', 'SITE SUPER'),
    ('STORE INCHARGE', 'SI'),
    ('STORE KEEPER', 'STO'),
    ('STRUCTURE DESIGN ENGINEER', 'SE'),
    ('SUPERVISOR', 'SUP'),
    ('SWEEPER', 'SWEEPER'),
    ('TOLL COLLECTOR', 'TOLL'),
    ('WELDER', 'WELDER')
),
normalized_designations as (
  select
    designation_name,
    designation_code,
    upper(regexp_replace(btrim(designation_name), '[[:space:]]+', ' ', 'g')) as normalized_name
  from source_designations
),
organization_designations as (
  select
    organizations.id as organization_id,
    source.designation_name,
    source.designation_code,
    source.normalized_name
  from public.organizations
  cross join normalized_designations source
)
insert into public.hr_designations (
  organization_id,
  department_id,
  designation_name,
  designation_code,
  status,
  created_at
)
select
  source.organization_id,
  null,
  source.designation_name,
  source.designation_code,
  'active',
  now()
from organization_designations source
where not exists (
  select 1
  from public.hr_designations existing
  where existing.organization_id = source.organization_id
    and upper(regexp_replace(btrim(existing.designation_name), '[[:space:]]+', ' ', 'g')) = source.normalized_name
);

commit;
