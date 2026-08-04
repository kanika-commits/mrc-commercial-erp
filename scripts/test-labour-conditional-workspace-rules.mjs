import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import ts from "typescript";
import { createRequire } from "node:module";

const root = process.cwd();
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function resolveAlias(request, parent, isMain, options) {
  if (request.startsWith("@/")) request = path.join(root, request.slice(2));
  return originalResolve.call(this, request, parent, isMain, options);
};
Module._extensions[".ts"] = function loadTs(module, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  module._compile(output, filename);
};

const require = createRequire(import.meta.url);
const {
  resolveSingleLabourContext,
  resolveSingleLabourSiteId,
  selectedLabourContextIsValid,
  selectedLabourSiteIsValid,
  shouldShowLabourWorkspace,
} = require("../lib/labour/attendanceSystemContext.ts");

const singleSummary = {
  pairs: [{
    organization_id: "org-1",
    company_id: "company-1",
    site_id: "site-1",
    attendance_system: "standard",
  }],
  attendance_systems: ["standard"],
};
const multiSummary = {
  pairs: [
    singleSummary.pairs[0],
    {
      organization_id: "org-1",
      company_id: "company-1",
      site_id: "site-2",
      attendance_system: "site_in_engineer",
    },
  ],
  attendance_systems: ["standard", "site_in_engineer"],
};
const singleSiteMultiCompanySummary = {
  pairs: [
    singleSummary.pairs[0],
    {
      organization_id: "org-1",
      company_id: "company-2",
      site_id: "site-1",
      attendance_system: "standard",
    },
    {
      organization_id: "org-1",
      company_id: "company-3",
      site_id: "site-1",
      attendance_system: "standard",
    },
  ],
  attendance_systems: ["standard"],
};
const zeroSummary = { pairs: [], attendance_systems: [] };

assert.deepEqual(resolveSingleLabourContext(singleSummary), singleSummary.pairs[0], "single-context summary resolves the one live Company/Site pair");
assert.equal(resolveSingleLabourContext(multiSummary), null, "multi-context summary must not choose an arbitrary Company/Site pair");
assert.equal(resolveSingleLabourContext(zeroSummary), null, "zero-context summary must not produce a fake context");
assert.equal(resolveSingleLabourSiteId(singleSummary), "site-1", "single site resolves for one Company/Site pair");
assert.equal(resolveSingleLabourSiteId(singleSiteMultiCompanySummary), "site-1", "one site with multiple companies still resolves the single attendance-system site");
assert.equal(resolveSingleLabourSiteId(multiSummary), null, "multiple sites must not auto-scope a site");
assert.equal(selectedLabourSiteIsValid("site-1", singleSiteMultiCompanySummary), true, "accessible selected Site is preserved");
assert.equal(selectedLabourSiteIsValid("stale-site", singleSiteMultiCompanySummary), false, "stale selected Site is not preserved");
assert.equal(selectedLabourSiteIsValid("", singleSiteMultiCompanySummary), false, "blank Site is eligible for single-site auto-scope");
assert.equal(shouldShowLabourWorkspace(singleSummary, false), false, "normal single-context users do not see Attendance Workspace");
assert.equal(shouldShowLabourWorkspace(singleSiteMultiCompanySummary, false), false, "one accessible site with multiple companies does not show Attendance Workspace");
assert.equal(shouldShowLabourWorkspace(singleSummary, true), true, "Platform Owner/Super Admin still see Attendance Workspace");
assert.equal(shouldShowLabourWorkspace(singleSiteMultiCompanySummary, true), true, "broad access still shows Attendance Workspace even with one site");
assert.equal(shouldShowLabourWorkspace(multiSummary, false), true, "multi-context users see Attendance Workspace");
assert.equal(shouldShowLabourWorkspace(zeroSummary, false), true, "zero-context users keep explicit Workspace/navigation safety");
assert.equal(selectedLabourContextIsValid(singleSummary.pairs[0], singleSummary), true, "current context is accepted when it exists in live lookup");
assert.equal(selectedLabourContextIsValid({ ...singleSummary.pairs[0], site_id: "stale-site" }, singleSummary), false, "stale localStorage context is rejected");

const appShell = fs.readFileSync("components/AppShell.tsx", "utf8");
const hrSectionNav = fs.readFileSync("components/hr/HrSectionNav.tsx", "utf8");
const hrLauncher = fs.readFileSync("app/modules/hr/page.tsx", "utf8");
const dailyAttendance = fs.readFileSync("app/labour/attendance/daily/page.tsx", "utf8");
const siteIn = fs.readFileSync("app/labour/site-in/page.tsx", "utf8");
const engineerDaily = fs.readFileSync("app/labour/engineer-daily/page.tsx", "utf8");
const approvals = fs.readFileSync("app/labour/approvals/page.tsx", "utf8");
const labourNew = fs.readFileSync("app/labour/workers/new/page.tsx", "utf8");

for (const [label, source] of [
  ["AppShell", appShell],
  ["HrSectionNav", hrSectionNav],
  ["HR launcher", hrLauncher],
]) {
  assert.match(source, /shouldShowLabourWorkspace/, `${label} must use the central Workspace visibility helper`);
}

for (const [label, source] of [
  ["Standard Attendance", dailyAttendance],
  ["Site-In", siteIn],
  ["Engineer Daily", engineerDaily],
  ["Labour Approval", approvals],
  ["Labour Registration New", labourNew],
]) {
  assert.match(source, /resolveSingleLabourSiteId/, `${label} must auto-scope from the live single Labour site`);
  assert.match(source, /selectedLabourSiteIsValid/, `${label} must preserve only a currently accessible selected Site`);
  assert.match(source, /subscribeLabourWorkspaceSummary/, `${label} must subscribe to the live Labour workspace summary`);
  assert.doesNotMatch(source, /company_id: single(?:Context|Site)/, `${label} must not auto-select Company from single-site Workspace state`);
}

for (const [label, source] of [
  ["Standard Attendance", dailyAttendance],
  ["Site-In", siteIn],
  ["Engineer Daily", engineerDaily],
]) {
  assert.match(source, /selectedLabourContextIsValid/, `${label} must reject stale stored Labour context`);
}

assert.match(appShell, /selectedLabourContextIsValid\(current, summary\)/, "AppShell bootstrap must validate stored context against live lookup");
assert.doesNotMatch(appShell, /summary\.pairs\.length === 1[\s\S]+writeSelectedLabourContext/, "AppShell must not auto-write a Company/Site context merely because one pair exists");
assert.doesNotMatch(appShell, /labour_workspace", "\/labour"/, "Attendance Workspace must not be rendered through the normal permission navLeaf helper");

console.log("Labour conditional workspace rules passed.");
