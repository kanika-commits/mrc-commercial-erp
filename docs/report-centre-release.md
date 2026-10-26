# Reports Centre release

The Reports Centre replaces the former generic report-builder route and dataset with the supported report surfaces:

- `/reports` and `/modules/reports` provide the same permission-protected landing experience.
- `/api/reports/labour-audit` provides organization-, company-, and site-scoped labour audit results and exports.
- `/api/reports/vendors` provides organization-scoped vendor master and vendor-audit results.

The verified Work Order report builder remains available at `/reports/builder` with `/api/reports/run`; it is retained because it is the existing Work Order reporting capability. The newer Report Centre is the primary landing surface, while the builder remains a supported focused workflow. No report data is migrated or seeded by this release. Report APIs remain server-side and require the exact report-specific permissions; browser roles are not intended to query the audit tables directly.
