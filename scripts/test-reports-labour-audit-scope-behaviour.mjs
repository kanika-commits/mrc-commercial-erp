import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

const source = fs.readFileSync("lib/reports/labourAuditScope.ts", "utf8");
const compiled = ts.transpile(source, { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS });
const module = { exports: {} };
new Function("module", "exports", compiled)(module, module.exports);
const { actorAssignmentsCoverScope, filterAuditRowsByScope } = module.exports;
const EAST = "EAST_VIEW";
const CRPF = "CRPF";
const JAMMU = "JAMMU";

const actors = {
  ORG_ADMIN: [{ company_id: null, site_id: null }],
  EAST_USER: [{ company_id: null, site_id: EAST }],
  CRPF_USER: [{ company_id: null, site_id: CRPF }],
  MULTI_USER: [{ company_id: null, site_id: EAST }, { company_id: null, site_id: CRPF }],
};
const eligible = (siteId) => Object.entries(actors).filter(([, assignments]) => actorAssignmentsCoverScope(assignments, { companyId: null, siteId })).map(([id]) => id);
assert.deepEqual(eligible(EAST), ["ORG_ADMIN", "EAST_USER", "MULTI_USER"]);
assert.deepEqual(eligible(CRPF), ["ORG_ADMIN", "CRPF_USER", "MULTI_USER"]);
assert.deepEqual(eligible(JAMMU), ["ORG_ADMIN"]);
assert.deepEqual(eligible(null), ["ORG_ADMIN", "EAST_USER", "CRPF_USER", "MULTI_USER"]);

const rows = [
  { id: "east", site_id: EAST, company_id: "A" },
  { id: "crpf", site_id: CRPF, company_id: "B" },
  { id: "jammu", site_id: JAMMU, company_id: "C" },
];
assert.deepEqual(filterAuditRowsByScope(rows, { companyId: null, siteId: EAST }).map((row) => row.id), ["east"]);
assert.deepEqual(filterAuditRowsByScope(rows, { companyId: null, siteId: CRPF }).map((row) => row.id), ["crpf"]);
assert.deepEqual(filterAuditRowsByScope(rows, { companyId: null, siteId: null }).map((row) => row.id), ["east", "crpf", "jammu"]);
assert.deepEqual(filterAuditRowsByScope(rows, { companyId: "A", siteId: CRPF }), [], "Sites remain company-neutral; company and site are an intersection of row scope");

console.log("Labour Audit behavioural scope tests passed.");
