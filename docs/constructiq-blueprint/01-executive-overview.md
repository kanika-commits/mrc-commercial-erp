# Volume 1 - Executive Overview

Last audited: 2026-08-02

## 1. Product Identity

**Product name:** ConstructIQ - MRC Commercial ERP.

**Confirmed current facts:** ConstructIQ is a Next.js App Router ERP backed by Supabase Auth, Supabase Postgres, Supabase Storage, and API routes under `app/api`. It is deployed as a web application and contains implemented modules for administration, master data, HR, labour, vendors, work orders, RA bills, invoices, payments, debit notes, approvals, imports, documents, and notifications. Evidence: `app`, `components/AuthGuard.tsx`, `lib/supabase.ts`, `supabase/migrations`, `app/api`.

**Business purpose:** ConstructIQ supports operational and commercial control for a construction company. It connects companies, independent sites, vendors/contractors, work orders, employee and labour master records, attendance, approvals, commercial documents, and payment tracking.

**Target organization:** MRC group / MRC Commercial ERP operations. The code supports multiple organizations through `organizations`, scoped users, roles, companies, sites, and access assignments.

**Operational problem being solved:** Construction operations involve multiple companies, sites, vendors, contractors, labour teams, attendance systems, approval layers, commercial documents, and payment states. ConstructIQ centralizes these records and introduces permission-scoped workflows with audit history.

**Current deployment model:** Web ERP using Next.js, Supabase, Vercel conventions, GitHub source control, Supabase storage, and Google Drive integration helpers where implemented.

**Business intent inferred from workflows:** The ERP is intended to preserve historical operational records, require approval before finalization, enforce module/action permissions, keep labour attendance site-based, and progressively connect operations to finance and payroll.

**Future/productization ideas not yet complete:** Payroll, full salary processing, store/inventory, reports, support workflows, ledger, and deeper cost consolidation are visible as placeholders or partially implemented workflows.

## 2. User Groups

| User group | Current capability from code | Evidence | Confidence |
| ---------- | ---------------------------- | -------- | ---------- |
| Platform Owner | Global access/wildcard behavior, broad access to modules, special handling in delete/override patterns | `lib/accessControl.ts`, `lib/serverAccountAccess.ts`, `components/AuthGuard.tsx` | Confirmed |
| Super Admin | Global-style access behavior similar to Platform Owner in guards/navigation | `lib/accessControl.ts`, `lib/serverOrganizationScope.ts`, `components/AppShell.tsx` | Confirmed |
| Admin | User, role, permission, organization, company, site, and master management when permissions are assigned | `app/admin`, `app/organizations`, `app/companies`, `app/sites`, `lib/permissionMatrix.ts` | Confirmed |
| HR | Employee registration/import, attendance, approvals, reimbursement, labour registration, labour attendance, configuration based on permissions | `app/hr`, `app/labour`, `components/hr/HrSectionNav.tsx` | Confirmed |
| Site Engineer | Site-In / Engineer Daily Labour workflows where labour permissions and assignment rules apply | `app/labour/site-in`, `app/labour/engineer-daily`, `app/api/labour/site-in/route.ts`, `app/api/labour/engineer-daily/route.ts` | Confirmed |
| Project Manager | Labour approval PM actions and commercial approvals where configured | `app/api/labour/approvals/route.ts`, `app/approvals` | Partially confirmed |
| Head Office Approver | HO HR approval actions in labour daily submission permissions | `lib/permissionMatrix.ts`, `app/api/labour/approvals/route.ts` | Confirmed |
| Accounts | Invoices, ITC review, payments, bank accounts, commercial registers when permissions exist | `app/invoices`, `app/payments`, `app/company-bank-accounts` | Confirmed |
| Directors / Management | Read-only registers, approvals, dashboard and future reports depending on permissions | `app/page.tsx`, `app/labour/approvals/page.tsx`, `app/modules/reports/page.tsx` | Partially confirmed |
| Site users | Access-scoped operational pages for site attendance/labour workflows | `lib/serverAccountAccess.ts`, `app/api/labour/lookups/route.ts` | Confirmed |

## 3. ERP Module Map

| Top-level group | Current state | Notes |
| --------------- | ------------- | ----- |
| Dashboard | Real | KPI/count page and notification counts exist. |
| Project Management | Real | RA Bills, Debit Notes, and commercial approvals are implemented. |
| Store Management | Placeholder | Sidebar/module page contains placeholder text; no active store workflow found. |
| Human Resources | Real | Employee, attendance, reimbursement, and labour/muster workflows are active. |
| Purchase | Real | Work Orders and Work Order Approval are active. |
| Accounts / Finance | Real | Invoices, ITC Review, Payments, and Bank Accounts are active. |
| Settings | Real | Masters and policy pages exist; Change Password is available to authenticated users. |
| Admin | Real | Organizations, Users, Roles, Permissions are implemented. |
| Reports | Placeholder/hidden | `reports` permission exists and module route exists, but `/reports` page is not implemented in `app`. |
| Support | Placeholder | Module route exists as a placeholder; no active support workflow found. |

Evidence: `components/AppShell.tsx`, `components/ModulePage.tsx`, `lib/defaultModuleNavigation.ts`, `lib/permissionVisibility.ts`.

## 4. Core Business Entities

| Entity | Role in ERP | Evidence |
| ------ | ----------- | -------- |
| Organization | Top-level tenancy/scope | `app/organizations`, `app/api/admin/organizations/[id]/route.ts`, migrations |
| Company | Independent company master used across commercial, HR, labour, finance | `app/companies`, `app/api/companies/route.ts` |
| Site | Independent physical site master; labour attendance system is site-level in recent migrations | `app/sites`, `supabase/migrations/202607310001_site_level_labour_attendance_system.sql` |
| User | Supabase-authenticated ERP login with role and access assignments | `app/admin/users`, `lib/accessControl.ts` |
| Role | Permission template for users | `app/admin/roles`, `role_permissions` references |
| Vendor / Contractor | Commercial party and labour contractor source | `app/vendors`, `app/labour/contractors`, `app/api/vendors/route.ts` |
| Work Order | Purchase/commercial contract object linked to vendors and downstream commercial records | `app/work-orders`, `app/api/work-orders/route.ts` |
| Employee | Salaried staff profile with documents, attendance, salary history, imports | `app/hr/employees`, `supabase/migrations/202606230002_create_hr_phase1_schema.sql` |
| Labour Worker | Site/muster labour record with contractor, deployment, documents, Aadhaar, rate history | `app/labour/workers`, `app/api/labour/workers/route.ts` |
| Deployment | Labour assignment context: company, site, contractor, work order, trade, wage snapshot | `app/api/labour/workers/[id]/deployments/route.ts`, labour migrations |
| Attendance | Employee and labour attendance transactional records | `app/api/hr/attendance`, `app/api/labour/attendance` |
| RA Bill | Commercial billing document against work orders | `app/ra-bills`, `app/api/ra-bills/route.ts` |
| Invoice | Vendor invoice and ITC review object | `app/invoices`, `app/api/invoices/route.ts` |
| Debit Note | Commercial debit note workflow | `app/debit-notes`, `app/api/debit-notes/route.ts` |
| Payment | Payment tracking linked to commercial documents/accounts | `app/payments`, `app/api/payments/route.ts` |
| Audit Log | Cross-module audit trail | `lib/serverAudit.ts`, `supabase/migrations/202607200005_create_erp_audit_logs.sql` |

## 5. High-Level Business Flows

### Vendor to Payment

```text
Vendor
-> Work Order
-> Work Order Approval
-> RA Bill / Invoice / Debit Note
-> Commercial approval / ITC review where applicable
-> Payment
-> Future ledger/reporting
```

Status: Operational through payment tracking; ledger/reporting remains incomplete.

### Labour - Standard Attendance

```text
Labour Registration
-> Deployment
-> Standard Labour Attendance
-> Submit Attendance Period
-> Labour Approval
-> Read-only Register / Monthly View
-> Future Wage Processing
```

Status: Operational; wage processing exists as routes/pages but requires separate maturity audit before production reliance.

### Labour - Site-In + Engineer Daily

```text
Labour Registration
-> Deployment
-> Site-In
-> Worker-level Engineer Assignment
-> Engineer Daily Labour
-> Labour Approval
-> Future Wage Processing
```

Status: Operational/under active refinement; permissions and approvals are present.

### Employee Attendance

```text
Employee Registration
-> Employee Attendance
-> Monthly Attendance Period Submit
-> Employee Attendance Approval
-> Lock / Audit
-> Future Salary Processing
```

Status: Operational; salary/payroll downstream is incomplete.

### Employee Import

```text
Excel Upload
-> Mapping / Preview / Validation
-> Execute
-> Employee Master
-> Documents / audit where applicable
```

Status: Operational with substantial parser/import infrastructure.

## 6. Platform Principles

| Principle | Current evidence | Exceptions / notes |
| --------- | ---------------- | ------------------ |
| Permission-first access | `components/AuthGuard.tsx`, `lib/permissionMatrix.ts`, `lib/serverPermissions.ts` | Some route families have explicit guard overrides due complex HR/Labour flows. |
| Organization/company/site scoping | `lib/serverAccountAccess.ts`, `lib/serverOrganizationScope.ts`, `app/api/labour/_shared.ts` | Company/Site are independent masters; labour operational pairs come from labour configuration/lookups. |
| Auditability | `lib/serverAudit.ts`, `lib/serverDeleteAudit.ts`, `erp_audit_logs` migration | Audit coverage varies by module and should be deepened in Volume 4/11. |
| Effective-dated labour rate history | `app/api/labour/workers/[id]/wage-rates/route.ts`, `labour_wage_rates` migration | UI recently exposes more audit fields; payroll usage needs further audit. |
| Approval-before-finalization | Work order, commercial, employee attendance, labour approval routes | Some future modules are placeholders. |
| Historical record preservation | Soft-delete/status patterns, deployment history, attendance periods, audit logs | Platform-owner delete features and hard-delete paths need detailed documentation in Volume 4/11. |
| Optional integrations | Google Drive/OCR/import code exists but is not universal | Coverage varies by module. |

## 7. Executive Maturity Summary

| Module | Maturity | Current capability | Main gap | Production risk |
| ------ | -------: | ------------------ | -------- | --------------- |
| Dashboard | Level 3 | Counts and operational links | Reporting depth and KPI verification | Medium |
| Project Management | Level 4 | RA Bills, Debit Notes, approval queue | Ledger/report consolidation | Medium |
| Store Management | Level 1 | Placeholder only | No implemented store workflow | Low until exposed |
| Human Resources - Employees | Level 4 | Employee master, imports, documents, attendance, approval | Salary/payroll connection incomplete | Medium |
| Human Resources - Labour | Level 4 | Labour registration, import, deployment, attendance, Site-In, Engineer Daily, approvals | Wage/payroll and reporting still maturing | Medium |
| Purchase | Level 4 | Work Orders, vendor links, approvals, documents | Cost integration and reporting gaps | Medium |
| Accounts / Finance | Level 3 | Invoices, ITC review, payments, bank accounts | Ledger/GST/TDS/reconciliation not complete | Medium |
| Settings | Level 4 | Masters and attendance policies | Some policy pages have complex overlap | Medium |
| Admin | Level 4 | Users, roles, permissions, organizations, scope | Permission complexity and hidden modules | Medium |
| Reports | Level 1 | Placeholder permission/module | No route implementation found | Low until activated |
| Support | Level 1 | Placeholder navigation | No workflow implemented | Low |

## 8. Current Strengths

- HR/Labour have deep operational coverage with imports, validation, documents, attendance, approvals, and audit paths.
- Permission action sets are explicit in `lib/permissionMatrix.ts`.
- Route protection has both navigation-driven and explicit HR/Labour overrides in `components/AuthGuard.tsx`.
- Supabase migrations show a clear evolution of HR and Labour schemas.
- Labour has mature site-attendance concepts: configuration, Site-In, engineer assignment, daily submissions, monthly read-only reporting, Aadhaar validation, and rate history.
- Commercial modules have integrated work order, RA bill, invoice, debit note, payment, and approval surfaces.

## 9. Current Risks

- **Permission complexity:** visible permissions, hidden technical modules, role permissions, user overrides, global access, and route exceptions all coexist.
- **Navigation duplication:** module launcher, sidebar, HR nav, default navigation, and permission visibility all carry related but separate mappings.
- **Placeholder exposure:** Store, Reports, Support, and Salary concepts exist in navigation/permissions but are not fully live.
- **Incomplete downstream accounting:** payment exists, but ledger, GST/TDS, bank reconciliation, and consolidated reports need verification.
- **Payroll gap:** employee attendance and labour attendance exist, but salary/wage finalization maturity is not yet proven as production complete.
- **Context complexity:** labour workspace and site attendance-system context depend on browser/local state plus server lookups.
- **Unexecuted migration risk:** migrations require a separate execution-state audit against the live database; repository presence alone is not proof of execution.
- **Large multifunction pages:** labour approvals, imports, worker registration/detail, and work order detail are large pages with many responsibilities.
