# ConstructIQ ERP Blueprint

Last audited: 2026-08-02

This blueprint is the living product and technical map for ConstructIQ, the MRC Commercial ERP. It is codebase-driven: facts in these documents should be updated from the repository, database migrations, API routes, permissions, and navigation code rather than from memory or intended future design.

## Planned Volumes

| Volume | Document | Status |
| ------ | -------- | ------ |
| 1 | [Executive Overview](01-executive-overview.md) | Initial audited draft |
| 2 | [System Architecture](02-system-architecture.md) | Initial audited draft |
| 3 | Functional Documentation | Not started |
| 4 | Database Blueprint | Not started |
| 5 | Permission Blueprint | Not started |
| 6 | Workflow Blueprint | Not started |
| 7 | Integration Map | Not started |
| 8 | Feature Matrix | Not started |
| 9 | Future Roadmap | Not started |
| 10 | Dependency Graph | Not started |
| 11 | Audit & Technical Debt Register | Not started |

## Maturity Legend

| Level | Meaning |
| ----: | ------- |
| 5 | Production Ready: complete workflow, permission enforcement, validation, audit/history, tests, and no known production blocker |
| 4 | Feature Complete: main workflow complete, with minor UX, reporting, or cleanup work remaining |
| 3 | Operational: usable, but workflow, reporting, permission, or integration gaps remain |
| 2 | Under Development: partially implemented and not ready for normal production use |
| 1 | Planned: placeholder, route stub, hidden module, or future concept |

## Maintenance Rule

Update this blueprint after significant changes to modules, routes, permissions, migrations, integrations, or core workflows. Volume 1 and Volume 2 should stay aligned with:

- `app`
- `components`
- `lib`
- `supabase/migrations`
- `scripts`
- navigation and permission configuration

## Evidence Convention

Repository-relative paths are used as evidence references, for example:

- `components/AppShell.tsx`
- `components/AuthGuard.tsx`
- `lib/permissionMatrix.ts`
- `app/api/labour/approvals/route.ts`

Uncertain findings are marked as `Confirmed`, `Partially confirmed`, or `Needs verification`.
