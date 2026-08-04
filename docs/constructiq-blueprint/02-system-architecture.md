# Volume 2 - System Architecture

Last audited: 2026-08-02

## 1. Application Architecture

ConstructIQ uses the Next.js App Router. Page routes live in `app/**/page.tsx`; API handlers live in `app/api/**/route.ts`; shared UI and guards live in `components`; business utilities and server helpers live in `lib`; schema evolution lives in `supabase/migrations`; regression tests live in `scripts`.

| Area | Current architecture | Evidence |
| ---- | -------------------- | -------- |
| App Router pages | Route folders under `app`; dynamic pages use `[id]` and `[rowId]` segments | `app` |
| API routes | REST-style route handlers under `app/api`; module-specific `_shared.ts` helpers are used in HR, Labour, approvals | `app/api`, `app/api/labour/_shared.ts`, `app/api/hr/attendance/_shared.ts` |
| Client auth | Supabase session loaded client-side through `lib/supabase.ts` and `components/AuthGuard.tsx` | `lib/supabase.ts`, `components/AuthGuard.tsx` |
| Server auth/authorization | Server helpers load permissions, scopes, and service-role clients | `lib/serverPermissions.ts`, `lib/serverAccountAccess.ts`, `lib/serverOrganizationScope.ts` |
| Navigation | Sidebar in `components/AppShell.tsx`; module launchers use `components/ModulePage.tsx`; fallback navigation in `lib/defaultModuleNavigation.ts` | Confirmed |
| Permission matrix | Actions in `lib/permissionMatrix.ts`; visible presentation in `lib/permissionVisibility.ts`; admin pages under `app/admin` | Confirmed |
| Audit | Generic ERP audit helper and deletion audit helper | `lib/serverAudit.ts`, `lib/serverDeleteAudit.ts` |
| Storage/integrations | Private storage helper, Google Drive helpers, document upload routes | `lib/storage/privateStorage.ts`, `src/lib/googleDrive.ts`, document routes |
| Deployment | Next.js/Vercel-compatible build | `package.json`, build output |

## 2. Complete Route Inventory

Audit result: 111 page routes and 164 API route handlers were found.

### Page Routes

| Module | Submodule | Page | Route | Page type | Permission | Navigation surface | Status | Maturity | Notes |
| ------ | --------- | ---- | ----- | --------- | ---------- | ------------------ | ------ | -------: | ----- |
| Dashboard | Dashboard | Dashboard | `/` | dashboard | `dashboard:view` | Sidebar | Active | 3 | Counts depend on notification/dashboard APIs. |
| Auth | Login | Login | `/login` | auth | Auth only | Direct | Active | 4 | Outside permission matrix. |
| Modules | Launcher | Module launcher | `/modules` | launcher | Auth only | Sidebar | Active | 3 | Unrestricted authenticated path in `AuthGuard`. |
| Modules | Project | Project launcher | `/modules/project-management` | launcher | Page permissions | Module launcher | Active | 3 | Launcher only. |
| Modules | Store | Store launcher | `/modules/store-management` | placeholder | Placeholder | Module launcher | Placeholder | 1 | No store workflow found. |
| Modules | HR | HR launcher | `/modules/hr` | launcher | HR permissions | Module launcher | Active | 4 | Includes Labour/Muster cards. |
| Modules | Purchase | Purchase launcher | `/modules/purchase` | launcher | Purchase permissions | Module launcher | Active | 4 | Work Order entry. |
| Modules | Accounts | Accounts launcher | `/modules/accounts` | launcher | Account permissions | Module launcher | Active | 3 | Invoices/payments/ITC. |
| Modules | Settings | Settings launcher | `/modules/settings` | launcher | Settings permissions | Module launcher | Active | 4 | Masters/policies grouping. |
| Modules | Admin | Admin launcher | `/modules/administration` | launcher | Admin permissions | Module launcher | Active | 4 | Admin pages. |
| Modules | Reports | Reports launcher | `/modules/reports` | placeholder | `reports:view` | Module launcher | Placeholder | 1 | `/reports` page not found. |
| Modules | Support | Support launcher | `/modules/support` | placeholder | Placeholder | Module launcher | Placeholder | 1 | Support workflow not found. |
| Modules | Construction | Construction launcher | `/modules/construction-management` | launcher/placeholder | Needs verification | Direct | Partial | 2 | Separate from active commercial routes. |
| Modules | Contract | Contract launcher | `/modules/contract-management` | launcher/placeholder | Needs verification | Direct | Partial | 2 | Needs route ownership review. |
| Modules | Master Setup | Master setup launcher | `/modules/master-setup` | launcher/placeholder | Needs verification | Direct | Partial | 2 | Legacy/alternate settings route. |
| Project Management | RA Bills | RA Bill list | `/ra-bills` | list | `ra_bills:view` | Sidebar/module | Active | 4 | |
| Project Management | RA Bills | Create RA Bill | `/ra-bills/new` | create | `ra_bills:add` | From list | Active | 4 | |
| Project Management | RA Bills | RA Bill detail | `/ra-bills/[id]` | detail | `ra_bills:view` | From list | Active | 4 | |
| Project Management | Debit Notes | Debit Note list | `/debit-notes` | list | `debit_notes:view` | Sidebar/module | Active | 4 | |
| Project Management | Debit Notes | Create Debit Note | `/debit-notes/new` | create | `debit_notes:add` | From list | Active | 4 | |
| Project Management | Debit Notes | Debit Note detail | `/debit-notes/[id]` | detail | `debit_notes:view` | From list | Active | 4 | |
| Project Management | Approvals | RA/Debit approval | `/approvals` | approval | `ra_approval:view` | Sidebar/module | Active | 4 | Shared commercial approval page. |
| Purchase | Work Orders | Work Order list | `/work-orders` | list | `work_orders:view` | Sidebar/module | Active | 4 | |
| Purchase | Work Orders | Create Work Order | `/work-orders/new` | create | `work_orders:add` | From list | Active | 4 | |
| Purchase | Work Orders | Work Order detail | `/work-orders/[id]` | detail | `work_orders:view` | From list | Active | 4 | Includes documents/changes/vendors. |
| Purchase | Work Order Approval | Approval queue | `/approvals/work-orders` | approval | `wo_approval:view` | Sidebar/module | Active | 4 | |
| Accounts | Invoices | Invoice list | `/invoices` | list | `invoices:view` | Sidebar/module | Active | 3 | |
| Accounts | Invoices | Create Invoice | `/invoices/new` | create | `invoices:add` | From list | Active | 3 | |
| Accounts | Invoices | Invoice detail | `/invoices/[id]` | detail | `invoices:view` | From list | Active | 3 | |
| Accounts | ITC | ITC Review | `/invoices/itc` | register/approval | `itc_claims:view` | Sidebar/module | Active | 3 | |
| Accounts | Payments | Payment list | `/payments` | list | `payments:view` | Sidebar/module | Active | 3 | |
| Accounts | Payments | Create Payment | `/payments/new` | create | `payments:add` | From list | Active | 3 | |
| Accounts | Payments | Payment detail | `/payments/[id]` | detail | `payments:view` | From list | Active | 3 | |
| Settings | Company Master | Company list | `/companies` | list | `companies:view` | Settings | Active | 4 | |
| Settings | Company Master | Create Company | `/companies/new` | create | `companies:add` | From list | Active | 4 | |
| Settings | Company Master | Company detail | `/companies/[id]` | detail | `companies:view` | From list | Active | 4 | |
| Settings | Company Master | Edit Company | `/companies/[id]/edit` | edit | `companies:edit` | From detail | Active | 4 | |
| Settings | Site Master | Site list | `/sites` | list | `sites:view` | Settings | Active | 4 | |
| Settings | Site Master | Create Site | `/sites/new` | create | `sites:add` | From list | Active | 4 | |
| Settings | Site Master | Site detail | `/sites/[id]` | detail | `sites:view` | From list | Active | 4 | |
| Settings | Site Master | Edit Site | `/sites/[id]/edit` | edit | `sites:edit` | From detail | Active | 4 | |
| Settings | Vendor Master | Vendor list | `/vendors` | list | `vendors:view` | Settings | Active | 4 | |
| Settings | Vendor Master | Create Vendor | `/vendors/new` | create | `vendors:add` | From list | Active | 4 | |
| Settings | Vendor Master | Vendor detail | `/vendors/[id]` | detail | `vendors:view` | From list | Active | 4 | |
| Settings | Vendor Master | Edit Vendor | `/vendors/[id]/edit` | edit | `vendors:edit` | From detail | Active | 4 | |
| Settings | Bank Accounts | Bank account list | `/company-bank-accounts` | list | `company_bank_accounts:view` | Settings | Active | 3 | |
| Settings | Bank Accounts | Create bank account | `/company-bank-accounts/new` | create | `company_bank_accounts:add` | From list | Active | 3 | |
| Settings | Bank Accounts | Bank account detail | `/company-bank-accounts/[id]` | detail | `company_bank_accounts:view` | From list | Active | 3 | |
| Settings | Bank Accounts | Edit bank account | `/company-bank-accounts/[id]/edit` | edit | `company_bank_accounts:edit` | From detail | Active | 3 | |
| Settings | Policies | Employee Attendance Policy | `/settings/policies/employee-attendance` | policy | `hr_employee_attendance_policy:view` | Settings | Active | 3 | |
| Settings | Policies | Labour Attendance Policy | `/labour/configuration` | policy | `labour_muster_configuration:view` | Settings/Muster | Active | 4 | |
| Settings | Password | Change Password | `/settings/password` | account | Auth only | Settings | Active | 3 | Not permission-controlled. |
| Settings | Appearance | Appearance | `/settings/appearance` | settings | Needs verification | Direct | Partial | 2 | Not visible in permission matrix. |
| HR | Employee Registration | Employee directory | `/hr/employees` | list | `hr_employees:view` | HR | Active | 4 | |
| HR | Employee Registration | Add employee | `/hr/employees/new` | create | `hr_employees:add` | From directory | Active | 4 | |
| HR | Employee Registration | Employee detail | `/hr/employees/[id]` | detail | `hr_employees:view` | From directory | Active | 4 | |
| HR | Employee Registration | Edit employee | `/hr/employees/[id]/edit` | edit | `hr_employees:edit` | From detail | Active | 4 | |
| HR | Employee Import | Employee import | `/hr/employees/import` | import | `hr_employee_import:view` | HR | Active | 4 | |
| HR | Document Import | Employee document import | `/hr/employees/import-documents` | import | `hr_employee_document_import:view` | Direct/hidden | Active | 3 | Hidden in visible permission matrix. |
| HR | Attendance | Attendance workspace | `/hr/attendance` | redirect/workspace | `hr_attendance:view` | HR | Active | 3 | Redirect/launcher style. |
| HR | Attendance | Daily Attendance | `/hr/attendance/daily` | register | `hr_attendance:view` | HR | Active | 3 | |
| HR | Attendance | Monthly Register | `/hr/attendance/monthly` | register | `hr_attendance:view` | HR | Active | 3 | |
| HR | Attendance Approval | Approval queue/detail | `/hr/attendance-approval` | approval | `hr_attendance_approval:view` | HR | Active | 3 | Monthly approval only per current design. |
| HR | Masters | Departments | `/hr/departments` | master | `hr_departments:view` | Settings | Active | 4 | |
| HR | Masters | Designations | `/hr/designations` | master | `hr_designations:view` | Settings | Active | 4 | |
| HR | Reimbursements | Reimbursement list | `/hr/reimbursements` | list | `reimbursements:view` | HR | Active | 4 | |
| HR | Reimbursements | New reimbursement | `/hr/reimbursements/new` | create | `reimbursements:add` | From list | Active | 4 | |
| HR | Reimbursements | Reimbursement detail | `/hr/reimbursements/[id]` | detail | `reimbursements:view` | From list | Active | 4 | |
| HR | Reimbursements | Edit reimbursement | `/hr/reimbursements/[id]/edit` | edit | `reimbursements:edit` | From detail | Active | 4 | |
| Labour | Workspace | Labour workspace | `/labour` | workspace | Any Labour permission | Muster/sidebar conditional | Active | 3 | Hidden for single-site users per context logic. |
| Labour | Dashboard | Labour dashboard | `/labour/dashboard` | dashboard | `labour_attendance:view` | Direct/hidden | Active | 2 | Needs navigation/status review. |
| Labour | Workers | Labour list | `/labour/workers` | list | `labour_workers:view` | Muster | Active | 4 | |
| Labour | Workers | Add labour | `/labour/workers/new` | create/import-batch UI | `labour_workers:add` | From list | Active | 4 | |
| Labour | Workers | Labour detail | `/labour/workers/[id]` | detail | `labour_workers:view` | From list | Active | 4 | |
| Labour | Workers | Edit labour | `/labour/workers/[id]/edit` | edit | `labour_workers:edit` | From detail | Active | 3 | Operational but has rate/deployment sensitivity. |
| Labour | Import | Labour import | `/labour/workers/import` | import | `labour_workers:import` | From list | Active | 4 | |
| Labour | Contractors | Labour contractor list | `/labour/contractors` | list | `labour_contractors:view` | Direct/hidden | Active | 3 | Hidden in visible matrix. |
| Labour | Contractors | Contractor detail | `/labour/contractors/[id]` | detail | `labour_contractors:view` | From list/detail link | Active | 3 | |
| Labour | Contractors | Edit contractor | `/labour/contractors/[id]/edit` | edit | `labour_contractors:edit` | From detail | Active | 3 | |
| Labour | Categories | Labour Categories | `/labour/trades` | master | `labour_trades:view` | Settings | Active | 4 | |
| Labour | Attendance | Daily Attendance | `/labour/attendance/daily` | register | `labour_attendance:view` | Muster conditional | Active | 4 | Standard workflow. |
| Labour | Attendance | Attendance Register | `/labour/attendance/register` | redirect | `labour_attendance:view` | Legacy/direct | Active | 2 | Redirects to `/labour/approvals?view=monthly`. |
| Labour | Attendance Import | Attendance import | `/labour/attendance/import` | import | `labour_attendance_import:view` | Direct/hidden | Partial | 2 | Needs workflow audit. |
| Labour | Site-In | Site-In | `/labour/site-in` | operation | `labour_site_in:view` | Muster conditional | Active | 4 | Engineer assignment integrated. |
| Labour | Engineer Daily | Engineer Daily Labour | `/labour/engineer-daily` | operation | `labour_engineer_daily:view` | Muster conditional | Active | 4 | |
| Labour | Teams | Temporary teams | `/labour/teams` | operation | `labour_engineer_groups:view` | Direct/hidden | Active | 3 | Superseded/related to Engineer Daily. |
| Labour | Approvals | Labour Approval / Monthly View | `/labour/approvals` | approval/register | `labour_daily_submission:view` or `labour_attendance:view` | Muster | Active | 4 | Combined daily approval + read-only monthly mode. |
| Labour | Policy | Labour configuration | `/labour/configuration` | policy | `labour_muster_configuration:view` | Settings/Muster | Active | 4 | |
| Labour | Policy legacy | Labour settings | `/labour/settings` | policy/legacy | `labour_attendance_policy:view` | Direct/hidden | Partial | 2 | Legacy policy route. |
| Labour | Manpower WOs | MWO list | `/labour/manpower-work-orders` | list | `labour_manpower_work_orders:view` | Direct/hidden | Active | 3 | |
| Labour | Manpower WOs | New MWO | `/labour/manpower-work-orders/new` | create | `labour_manpower_work_orders:add` | From list | Active | 3 | |
| Labour | Manpower WOs | MWO detail | `/labour/manpower-work-orders/[id]` | detail | `labour_manpower_work_orders:view` | From list | Active | 3 | |
| Labour | Manpower WOs | Edit MWO | `/labour/manpower-work-orders/[id]/edit` | edit | `labour_manpower_work_orders:edit` | From detail | Active | 3 | |
| Labour | Work Logs | Daily Work | `/labour/work-logs` | operation | `labour_work_logs:view` | Direct/hidden | Partial | 2 | Superseded by Engineer Daily combined UI in many flows. |
| Labour | Wages | Wages list | `/labour/wages` | payroll | `labour_wages:view` | Direct/hidden | Partial | 2 | Future/under development. |
| Labour | Wages | Wage detail | `/labour/wages/[id]` | detail | `labour_wages:view` | From list | Partial | 2 | |
| Labour | Advances | Advances | `/labour/advances` | finance | `labour_advances:view` | Direct/hidden | Partial | 2 | |
| Admin | Organizations | Organization list | `/organizations` | list | `organizations:view` | Admin | Active | 4 | |
| Admin | Organizations | New organization | `/organizations/new` | create | `organizations:add` | From list | Active | 4 | |
| Admin | Organizations | Organization detail | `/organizations/[id]` | detail | `organizations:view` | From list | Active | 4 | |
| Admin | Organizations | Edit organization | `/organizations/[id]/edit` | edit | `organizations:edit` | From detail | Active | 4 | |
| Admin | Users | User list | `/admin/users` | list | `users:view` | Admin | Active | 4 | |
| Admin | Users | New user | `/admin/users/new` | create | `users:add` | From list | Active | 4 | |
| Admin | Users | User detail/edit | `/admin/users/[id]` | detail/edit | `users:view/edit` | From list | Active | 4 | Includes permission overrides. |
| Admin | Roles | Role list | `/admin/roles` | list | `roles:view` | Admin | Active | 4 | |
| Admin | Roles | New role | `/admin/roles/new` | create | `roles:add` | From list | Active | 4 | |
| Admin | Permissions | Permission matrix | `/admin/permissions` | admin | `permissions:view` | Admin | Active | 4 | |
| Construction | Construction Management | Construction page | `/construction-management` | placeholder/launcher | Needs verification | Direct | Partial | 2 | Not in primary sidebar map. |
| Settings | Master Setup | Master setup | `/masters/master-setup` | legacy/launcher | Needs verification | Direct | Partial | 2 | Older setup route. |
| Settings | Settings root | Settings | `/settings` | launcher | Auth/global/settings | Sidebar/module | Active | 3 | |

### API Route Families

| Module | API route family | Primary responsibility | Permission pattern | Maturity |
| ------ | ---------------- | ---------------------- | ------------------ | -------: |
| Admin | `app/api/admin/*` | bootstrap, access options, users, roles, permissions, module navigation | server account/admin helpers | 4 |
| Masters | `app/api/companies`, `app/api/sites`, `app/api/vendors`, `app/api/company-bank-accounts` | master CRUD and activity | module permissions / server access helpers | 4 |
| Work Orders | `app/api/work-orders/*` | work order CRUD, documents, vendors, changes | work order permissions | 4 |
| Commercial approvals | `app/api/approvals/*` | RA/Debit approvals and Work Order approvals | approval permissions | 4 |
| RA Bills | `app/api/ra-bills/*` | RA bill CRUD, documents, registers, work-order vendor lookup | RA permissions | 4 |
| Debit Notes | `app/api/debit-notes/*` | Debit Note CRUD, documents | debit note permissions | 4 |
| Invoices | `app/api/invoices/*` | invoice CRUD, documents, ITC, register | invoice/ITC permissions | 3 |
| Payments | `app/api/payments/*` | payment CRUD/register/account lookup | payment permissions | 3 |
| HR employees | `app/api/hr/employees/*` | employee CRUD, documents, photo, audit, history, salary history | HR permissions | 4 |
| HR import | `app/api/hr/employee-import/*`, `app/api/hr/employee-document-import/*` | Excel import/mapping/report/execute | import permissions | 4 |
| HR attendance | `app/api/hr/attendance/*` | daily/monthly attendance, policies, approvals, locks | HR attendance permissions | 3 |
| HR reimbursements | `app/api/hr/reimbursements/*` | reimbursement workflow, documents, approval/payment | reimbursement permissions | 4 |
| Labour workers | `app/api/labour/workers/*` | worker CRUD, registration, OCR, documents, deployments, wage rates | labour permissions | 4 |
| Labour import | `app/api/labour/import/*` | Excel import/mapping/validation/report/execute | `labour_workers:import` | 4 |
| Labour attendance | `app/api/labour/attendance/*` | standard daily/monthly attendance and period transitions | `labour_attendance` + approval actions | 4 |
| Labour approvals | `app/api/labour/approvals` | standard and engineer daily approvals/monthly view/delete | `labour_daily_submission` / `labour_attendance` | 4 |
| Labour operations | `app/api/labour/site-in`, `engineer-daily`, `teams`, `work-logs`, `photo-evidence` | Site-In, engineer daily, teams, work logs, photos | labour operation permissions | 4/3 |
| Labour policy/master | `app/api/labour/configuration`, `attendance-policy`, `trades`, `contractors`, `lookups` | muster config, policies, categories, contractors, lookup data | labour permissions | 4 |
| Labour payroll-like | `app/api/labour/wages`, `advances`, `overtime`, `manpower-work-orders` | wages, advances, overtime, MWO | hidden/future labour permissions | 2/3 |
| Notifications | `app/api/notifications/counts` | dynamic notification counts | current-user permissions | 3 |

## 3. Module Hierarchy

```text
Dashboard
└── Dashboard

Project Management
├── RA Bills
├── Debit Notes
└── Approvals

Store Management
└── Placeholder

Human Resources
├── Employee Registration
│   ├── Employee Directory
│   ├── Add Employee
│   ├── Employee Detail
│   ├── Edit Employee
│   ├── Employee Import
│   └── Employee Document Import
├── Employee Attendance
│   ├── Daily Attendance
│   ├── Monthly Register
│   └── Attendance Approval
├── Masters
│   ├── Departments
│   └── Designations
├── Reimbursement
└── Muster / Labour
    ├── Labour Workspace
    ├── Labour Registration
    ├── Labour Import
    ├── Labour Contractors
    ├── Labour Categories
    ├── Standard Labour Attendance
    ├── Attendance Import
    ├── Site-In
    ├── Engineer Daily Labour
    ├── Temporary Teams
    ├── Labour Approval / Monthly View
    ├── Labour Attendance Policy / Configuration
    ├── Manpower Work Orders
    ├── Work Logs
    ├── Wages
    └── Advances

Purchase
├── Work Orders
└── Work Order Approval

Accounts / Finance
├── Invoices
├── ITC Review
├── Payments
└── Bank Accounts

Settings
├── Masters
│   ├── Companies
│   ├── Sites
│   ├── Vendors
│   ├── Departments
│   ├── Designations
│   ├── Labour Categories
│   └── Bank Accounts
├── Policies
│   ├── Employee Attendance Policy
│   └── Labour Attendance Policy
├── Change Password
└── Appearance / Master Setup legacy routes

Admin
├── Organizations
├── Users
├── Roles
└── Permissions

Reports
└── Placeholder

Support
└── Placeholder
```

## 4. Page-Level Documentation

The page inventory above records route-level ownership. Detailed page-by-page functional documentation belongs in Volume 3. The active standalone page families are summarized here:

| Page family | Purpose | Entry point | Permission | Major APIs | Primary tables | Upstream | Downstream | Maturity | Known issues / opportunities |
| ----------- | ------- | ----------- | ---------- | ---------- | -------------- | -------- | ---------- | -------: | ---------------------------- |
| Organizations | Manage organizations | `/organizations` | `organizations` | `app/api/admin/organizations/[id]` | organizations | Admin | Companies/users | 4 | Needs DB field-level doc. |
| Users/Roles/Permissions | Manage access | `/admin/users`, `/admin/roles`, `/admin/permissions` | `users`, `roles`, `permissions` | `app/api/admin/*` | profiles/users, roles, permissions, access assignments | Organizations | All modules | 4 | Permission complexity is high. |
| Companies/Sites/Vendors | Master data | `/companies`, `/sites`, `/vendors` | `companies`, `sites`, `vendors` | master APIs | companies, sites, vendors | Admin/settings | Work orders, labour, finance | 4 | Company/Site independence must remain explicit. |
| Work Orders | Create/manage commercial commitments | `/work-orders` | `work_orders` | `app/api/work-orders/*` | work_orders, documents, vendor links | Vendors/sites/companies | RA bills, invoices, payments, labour work order links | 4 | Cost rollups need future doc. |
| Commercial documents | RA Bills, Debit Notes, Approvals | `/ra-bills`, `/debit-notes`, `/approvals` | `ra_bills`, `debit_notes`, `ra_approval` | commercial APIs | RA/debit tables | Work orders/vendors | Payments | 4 | Approval granularity needs Volume 6. |
| Invoices/ITC/Payments | Finance transaction tracking | `/invoices`, `/invoices/itc`, `/payments` | `invoices`, `itc_claims`, `payments` | finance APIs | invoice/payment tables | Work orders/vendors/bank accounts | Ledger/reporting future | 3 | Accounting integrations incomplete. |
| Employee Master | Employee profile, docs, history | `/hr/employees` | `hr_employees` | `app/api/hr/employees/*` | hr_employees, employee docs/history | HR masters | Attendance/salary future | 4 | Salary downstream incomplete. |
| Employee Imports | Excel/document import | `/hr/employees/import`, `/hr/employees/import-documents` | import permissions | import APIs | import batches/rows, employees, docs | HR masters | Employee master | 4 | Batch state/audit needs Volume 4. |
| Employee Attendance | Daily/monthly attendance and approval | `/hr/attendance/daily`, `/hr/attendance/monthly`, `/hr/attendance-approval` | `hr_attendance`, `hr_attendance_approval` | `app/api/hr/attendance/*` | employee attendance tables | Employee/policy | Salary future | 3 | Monthly-only approval finalized; salary link future. |
| Reimbursements | Employee reimbursement workflow | `/hr/reimbursements` | `reimbursements` | reimbursement APIs | reimbursement tables/docs | Employee/HR | Payment/accounting future | 4 | Finance posting needs verification. |
| Labour Registration | Labour worker master/import/docs/deployment/rates | `/labour/workers` | `labour_workers` | worker/import/deployment/wage APIs | labour_workers, deployments, documents, wage_rates | Labour config/vendors/sites | Attendance/wages | 4 | Large page family; rate/deployment history sensitive. |
| Labour Attendance | Standard daily attendance and monthly view | `/labour/attendance/daily`, `/labour/approvals?view=monthly` | `labour_attendance` | labour attendance APIs | attendance periods/rows | Labour deployment/policy | Labour approval/wages | 4 | Wage processing not fully mature. |
| Site-In + Engineer Daily | Engineer-scoped daily operational workflow | `/labour/site-in`, `/labour/engineer-daily` | `labour_site_in`, `labour_engineer_daily` | site-in/engineer APIs | site_ins, assignments, groups, submissions | Labour deployment/config | Labour approval/wages | 4 | Complex state; needs Volume 6 diagrams. |
| Labour Approval | Standard register and engineer submission approval | `/labour/approvals` | `labour_daily_submission` or `labour_attendance:view` for monthly | approval API | attendance periods, daily submissions, events | Attendance/Engineer Daily | Wages/reporting | 4 | Combined permissions/page modes are complex. |
| Labour Configuration | Site workflow/policy responsibility | `/labour/configuration` | `labour_muster_configuration` | configuration API | labour site configurations/policies | Companies/sites/employees | Labour navigation/workflows | 4 | Critical source of Labour context. |
| Labour Wages/Advances/MWO | Wage/advance/rate structures | `/labour/wages`, `/labour/advances`, `/labour/manpower-work-orders` | hidden labour modules | respective APIs | wage/advance/MWO tables | Attendance/work orders | Payroll future | 2/3 | Under development. |

## 5. Navigation Architecture

| Surface | Implementation | Current behavior | Notes |
| ------- | -------------- | ---------------- | ----- |
| Main sidebar | `components/AppShell.tsx` | Builds nested module tree from permissions and Labour context | Has placeholders for Store, Salary, Support for global users. |
| Module launcher | `components/ModulePage.tsx` | Renders cards from module navigation, grouped Settings sections | Adds Employee Attendance Policy fallback. |
| Default navigation | `lib/defaultModuleNavigation.ts` | Approved groups/modules used when DB navigation is absent for global access | Contains reports/support groups and fallback settings routes. |
| Visible permission matrix | `lib/permissionVisibility.ts` | Shows active assignable rows only; hides technical/action-only modules | Avoids Support fallback for hidden Labour modules. |
| HR/Muster nav | `components/hr/HrSectionNav.tsx` | HR-specific tabs with Labour conditional workflow visibility | Depends on Labour context. |
| Labour workspace | `app/labour/page.tsx`, `lib/labour/attendanceSystemContext.ts` | Context selector/launcher for multi-site/global users | Should not be an authorization layer. |
| Legacy redirects | `app/labour/attendance/register/page.tsx` | Redirects to combined Labour Approval monthly view | Should remain documented to avoid duplicate page assumptions. |

## 6. Access Architecture

### Authentication

Supabase Auth sessions are read in `components/AuthGuard.tsx`, `components/AccessContext.tsx`, and client pages through `lib/supabase.ts`. Unauthenticated users are sent to `/login`.

### Authorization

Authorization is layered:

- Role permissions from `role_permissions`.
- User-level overrides from `user_permissions`.
- Wildcard/global access for Platform Owner / Super Admin.
- Client route protection in `components/AuthGuard.tsx`.
- Server route protection through `lib/serverPermissions.ts`, `lib/serverAccountAccess.ts`, and module helpers such as `app/api/labour/_shared.ts`.
- Page buttons use `can(...)` from `lib/accessControl.ts`.

### Data Scope

Data scope includes organization, company, and site access. Company and Site are independent masters. Labour-specific operational company/site/site-system context is resolved by Labour configuration and access-aware lookups rather than `sites.company_id`.

### Context

Labour context uses:

- `lib/labour/attendanceSystemContext.ts`
- `/api/labour/lookups?purpose=labour_workspace`
- browser/local state for selected Labour context
- validation to clear stale context

Single-site users can bypass the Labour Workspace; multi-site/global users keep the Workspace.

## 7. Module Connection Matrix

| Source module | Connected module | Connection | Current state | Data link | Gap |
| ------------- | ---------------- | ---------- | ------------- | --------- | --- |
| Organization | Users/Roles/Companies/Sites | tenancy/scope | Active | organization IDs | Needs DB-level doc. |
| User | Role / Access Assignment | authorization and data scope | Active | profiles, roles, role_permissions, user_permissions, access assignments | Permission complexity. |
| Vendor | Work Order | vendor/contractor party | Active | work order vendor links | Needs full relationship doc. |
| Work Order | RA Bill | billing reference | Active | work order IDs | Reporting linkage future. |
| Work Order | Invoice | invoice reference | Active | work order IDs | Accounting lifecycle incomplete. |
| Work Order | Labour | optional labour work order/deployment link | Active/partial | `current_work_order_id`, deployment work order IDs | Cost rollups future. |
| RA Bill / Debit Note | Approvals | commercial approval workflow | Active | approval APIs/status | Multi-level detail doc pending. |
| Invoice | ITC Review | tax credit review | Active | invoice status/ITC API | GST reporting future. |
| Payment | Vendor / Work Order / Bank Account | payment tracking | Active | payment references | Ledger/reconciliation future. |
| Employee | Attendance | employee attendance entries | Active | employee IDs | Salary downstream future. |
| Employee Attendance | Approval | monthly period approval | Active | attendance period IDs | Payroll lock integration future. |
| Labour Worker | Deployment | active company/site/contractor/work order context | Active | labour_deployments | Transfer/rate history sensitive. |
| Deployment | Attendance | attendance population and rate snapshot | Active | deployment IDs/worker IDs | Wage generation future. |
| Labour Attendance | Approval | site/date register approval | Active | attendance periods and rows | Contractor-period atomicity needs ongoing tests. |
| Site-In | Engineer Daily | worker-level engineer assignment | Active | site-in assignments, engineer IDs | Needs workflow diagrams. |
| Engineer Daily | Labour Approval | submission package approval | Active | labour_daily_submissions | HO/PM rules need Volume 6. |
| Audit Log | All audited modules | history and traceability | Active/partial | erp_audit_logs | Coverage varies. |

## 8. Disconnected or Incomplete Connections

| Area | What exists | Missing / risk | Status |
| ---- | ----------- | -------------- | ------ |
| Labour Attendance -> wage generation | Wage routes/tables exist | Production wage calculation/finalization maturity not yet proven | Partially confirmed |
| Employee Attendance -> salary | Employee attendance and salary history exist | Salary/payroll page is hidden/placeholder | Partially confirmed |
| Approved attendance -> payment | Attendance approval and payments exist | Direct payroll/payment posting not confirmed | Needs verification |
| Work Order labour cost totals | Work order links to labour deployment exist | Cost aggregation not confirmed | Needs verification |
| Site expenditure consolidation | Commercial and labour data exist | Unified site P&L/report not implemented | Needs verification |
| Reports | Module/permission placeholder exists | `/reports` page absent | Confirmed incomplete |
| Store Management | Placeholder visible to global users | No store APIs/pages found | Confirmed incomplete |
| Support | Placeholder visible to global users | No support APIs/pages found | Confirmed incomplete |
| Ledger | Payments exist | Ledger module/page not found | Confirmed incomplete |
| Notifications | Dynamic counts exist | Persistent notification lifecycle coverage varies | Partially confirmed |
| Google Drive coverage | Vendor/WO/HR/Labour import/document helpers exist | Not universal across documents | Partially confirmed |
| Document verification | Import/document storage flows exist | Verification completeness varies by module | Needs verification |

## 9. API and Data Ownership Map

| Module | Page routes | API route families | Primary tables | Lookup/storage/audit |
| ------ | ----------- | ------------------ | -------------- | -------------------- |
| Admin | `/admin/*`, `/organizations/*` | `app/api/admin/*` | organizations, users/profiles, roles, permissions, access assignments | audit via admin routes |
| Masters | `/companies`, `/sites`, `/vendors`, `/company-bank-accounts` | master APIs | companies, sites, vendors, bank accounts | vendor activity/audit, documents |
| Purchase | `/work-orders`, `/approvals/work-orders` | `app/api/work-orders/*`, `app/api/approvals/work-orders` | work_orders, changes, vendor links, documents | Google Drive/document helpers |
| Project Management | `/ra-bills`, `/debit-notes`, `/approvals` | RA/debit/approvals APIs | RA bill/debit note tables, documents | audit/delete reasons |
| Accounts | `/invoices`, `/invoices/itc`, `/payments` | invoice/payment APIs | invoices, payments, bank account links | ITC review, registers |
| HR | `/hr/*`, `/settings/policies/employee-attendance` | `app/api/hr/*` | hr_employees, departments, designations, attendance, policies, reimbursements, imports | Supabase Storage, Drive sync, audit |
| Labour | `/labour/*` | `app/api/labour/*` | labour_workers, deployments, attendance, site-ins, submissions, documents, wages, policies | Supabase Storage, OCR, imports, audit |
| Notifications | header/sidebar | `app/api/notifications/counts` | source tables across modules | dynamic counts |

## 10. Integration Map

| Integration | Current classification | Evidence | Notes |
| ----------- | ---------------------- | -------- | ----- |
| Supabase Auth | Active | `lib/supabase.ts`, `components/AuthGuard.tsx` | Primary login/session provider. |
| Supabase Postgres | Active | API routes, migrations | Main database. |
| Supabase Storage | Active | `lib/storage/privateStorage.ts`, document routes | Private documents and photos. |
| Google Drive / Apps Script | Partial/active | `src/lib/googleDrive.ts`, Drive sync/import routes | Used in Work Order/Vendor/HR/Labour document flows. |
| Excel imports | Active | HR and Labour import APIs, `lib/hr/employeeImport.ts`, `lib/labour/import.ts` | Mature but complex. |
| OCR | Partial/active | `app/api/labour/workers/ocr/route.ts` | Labour document/registration support. |
| Vercel | Active deployment target | Next build config and route output | Deployment execution not audited here. |
| GitHub | Source-control platform | repository context | CI/release workflow not audited. |
| Dynamic notification counts | Active | `app/api/notifications/counts/route.ts`, `components/NotificationCountsContext.tsx` | Counts, not full notification inbox. |

## 11. Complexity Review

| Complexity | Classification | Evidence | Comment |
| ---------- | -------------- | -------- | ------- |
| Duplicate navigation configuration | Medium risk | `components/AppShell.tsx`, `components/ModulePage.tsx`, `lib/defaultModuleNavigation.ts`, `components/hr/HrSectionNav.tsx` | Consolidation would reduce regressions. |
| Duplicate permission configuration | Medium risk | DB modules, `lib/permissionMatrix.ts`, `lib/permissionVisibility.ts`, AuthGuard explicit mappings | Requires careful Phase 5 documentation. |
| Route/API permission mismatches | Medium risk | Recent focused permission tests and explicit overrides | Continue adding route/action tests. |
| Combined routes with multiple permissions | Medium risk | `/labour/approvals` daily approval and monthly view | Powerful but easy to regress. |
| Shared lookup authorization | Medium risk | HR/Labour lookup APIs support purposes and scoped access | Needs ownership rules in Volume 3/5. |
| Context/localStorage complexity | Medium risk | Labour workspace context | Must protect multi-site users and stale context. |
| Large multifunction pages | Medium risk | Labour approval/import/worker pages, Work Order detail | Harder to test and maintain. |
| Duplicate validation paths | High risk | Preview/execute/import/register paths | Import execution must match preview. |
| Hidden technical modules | Cleanup only/medium | `lib/permissionVisibility.ts` hidden modules | Must preserve saved permissions. |
| Legacy routes | Cleanup only | `/labour/attendance/register`, `/labour/settings`, `/masters/master-setup` | Keep redirects documented. |

## 12. Architecture Maturity Table

| Module | Pages audited | APIs audited | Permissions audited | Data links audited | Maturity | Main blocker |
| ------ | ------------: | -----------: | ------------------: | -----------------: | -------: | ------------ |
| Dashboard | 1 | 1 | Yes | Partial | 3 | KPI/reporting depth |
| Project Management | 7 | 8+ | Yes | Partial | 4 | Ledger/report links |
| Store Management | 1 | 0 | Yes | No | 1 | Placeholder only |
| Human Resources | 22 | 50+ | Yes | Partial | 4 | Salary/payroll completion |
| Labour | 29 | 60+ | Yes | Partial | 4 | Wage/payroll/reporting maturity |
| Purchase | 4 | 7+ | Yes | Partial | 4 | Cost integration |
| Accounts / Finance | 8 | 8+ | Yes | Partial | 3 | Ledger/GST/reconciliation |
| Settings | 25+ shared routes | 10+ | Yes | Partial | 4 | Shared masters/policy overlap |
| Admin | 10 | 9+ | Yes | Partial | 4 | Permission complexity |
| Reports | 1 launcher | 0 | Yes | No | 1 | No implementation |
| Support | 1 launcher | 0 | No active permission row | No | 1 | No implementation |

## 13. Recommended Documentation Sequence

Next documentation phase: **Volume 3 - Functional Documentation**, beginning with:

1. Admin / Access Control
2. HR Employee Master and Employee Attendance
3. Labour Registration, Attendance, Site-In, Engineer Daily, and Labour Approval

This order is recommended because these modules control user access, daily operational data, and the highest-risk workflows.
