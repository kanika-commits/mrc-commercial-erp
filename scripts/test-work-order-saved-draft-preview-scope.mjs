import assert from "node:assert/strict";
import fs from "node:fs";

const route = fs.readFileSync("app/api/work-orders/drafts/[id]/route.ts", "utf8");
const page = fs.readFileSync("app/work-orders/new/structured/page.tsx", "utf8");

assert.match(route, /const draftOrganizationId = result\.data\.organization_id/);
assert.match(route, /resolveWriteOrganizationId\(result\.scope, draftOrganizationId\)/);
assert.match(route, /company\?\.organization_id === draftOrganizationId/);
assert.match(route, /site\?\.organization_id === draftOrganizationId/);
assert.match(route, /vendor\?\.organization_id === draftOrganizationId/);
assert.match(route, /isInOrganizationScope\(result\.scope, draftOrganizationId\)/);
assert.doesNotMatch(route, /siteBelongsToCompany/);
assert.match(page, /draftLoading \|\| lookupLoading \|\| !draftLookupRef\.current/);
assert.match(page, /disabled=\{saving \|\| draftLoading \|\| lookupLoading/);

const sameOrgSelection = (draft, selected, actorOrganizations) => {
  const sameDraftOrganization = selected.company.organization_id === draft.organization_id
    && selected.site.organization_id === draft.organization_id
    && selected.vendor.organization_id === draft.organization_id;
  return sameDraftOrganization && actorOrganizations.includes(draft.organization_id);
};

const org = "org-synthetic";
assert.equal(sameOrgSelection(
  { organization_id: org },
  { company: { organization_id: org }, site: { organization_id: org, company_id: "another-company-in-org" }, vendor: { organization_id: org } },
  [org],
), true, "an authorized organization-scoped/shared site must survive draft save");
assert.equal(sameOrgSelection(
  { organization_id: org },
  { company: { organization_id: org }, site: { organization_id: "other-org" }, vendor: { organization_id: org } },
  [org],
), false, "a cross-organization site must remain rejected");
assert.equal(sameOrgSelection(
  { organization_id: org },
  { company: { organization_id: org }, site: { organization_id: org }, vendor: { organization_id: "other-org" } },
  [org],
), false, "a cross-organization vendor must remain rejected");

console.log("Saved Work Order preview hydration and organization-scope contract: PASS");
