import assert from "node:assert/strict";
import fs from "node:fs";

function normalizeText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalizeIdentifier(value) {
  const text = normalizeText(value);
  if (!text) return null;
  const normalized = text.replace(/\s+/g, "").toUpperCase();
  if (["0", "0.0", "0.00", "-", "NA", "N/A", "NIL", "NONE", "NULL", "NOTAVAILABLE", "NOT AVAILABLE"].includes(normalized)) {
    return null;
  }
  return normalized;
}

function normalizeLabourCode(value) {
  const text = normalizeText(value);
  if (!text) return null;
  if (/^\d+$/.test(text)) return text.replace(/^0+(?=\d)/, "") || "0";
  return text.toUpperCase();
}

function formatLabourCode(value) {
  const text = normalizeText(value);
  if (!text) return "-";
  if (/^\d+$/.test(text)) return String(Number(text)).padStart(3, "0");
  return text;
}

function previousDay(dateText) {
  const date = new Date(`${dateText}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function hasOverlap(existing, nextFrom, nextTo = null) {
  const nextEnd = nextTo || "9999-12-31";
  return existing.some((row) => {
    const rowEnd = row.effective_to || "9999-12-31";
    return row.effective_from <= nextEnd && rowEnd >= nextFrom;
  });
}

function scopedAllowed(assignments, companyId, siteId) {
  if (assignments.companyIds === null && assignments.siteIds === null) return true;
  return Boolean(
    assignments.companyIds?.length &&
    assignments.siteIds?.length &&
    assignments.companyIds.includes(companyId) &&
    assignments.siteIds.includes(siteId),
  );
}

assert.equal(normalizeIdentifier("0"), null, "Sentinel Aadhaar 0 should not be unique identity");
assert.equal(normalizeIdentifier(" 1234 5678 9012 "), "123456789012", "Aadhaar should normalize whitespace");
assert.equal(normalizeLabourCode("1"), "1", "Labour Code 1 canonicalizes to numeric identity 1");
assert.equal(normalizeLabourCode("01"), "1", "Labour Code 01 canonicalizes to numeric identity 1");
assert.equal(normalizeLabourCode(" 001 "), "1", "Labour Code 001 canonicalizes to numeric identity 1");
assert.equal(formatLabourCode("1"), "001", "Labour Code 1 displays as 001");
assert.equal(formatLabourCode("01"), "001", "Labour Code 01 displays as 001");
assert.equal(formatLabourCode("001"), "001", "Labour Code 001 displays as 001");
assert.equal(formatLabourCode("125"), "125", "Labour Code 125 displays as 125");
assert.equal(normalizeLabourCode(" ho-1 "), "HO-1", "Historical non-numeric Labour Codes are normalized by trim/case only");
assert.equal(previousDay("2026-07-10"), "2026-07-09", "Transfer should close previous deployment the day before");
assert.equal(hasOverlap([{ effective_from: "2026-07-01", effective_to: null }], "2026-07-10"), true, "Open deployment overlaps future date");
assert.equal(hasOverlap([{ effective_from: "2026-07-01", effective_to: "2026-07-09" }], "2026-07-10"), false, "Closed deployment should not overlap next day");
assert.equal(scopedAllowed({ companyIds: ["c1"], siteIds: ["s1"] }, "c1", "s1"), true, "Users need both assigned company and site");
assert.equal(scopedAllowed({ companyIds: ["c1"], siteIds: ["s1"] }, "c1", "s2"), false, "Unassigned sites are blocked");
assert.equal(scopedAllowed({ companyIds: ["c1"], siteIds: ["s1"] }, "c2", "s1"), false, "Unassigned companies are blocked");
assert.equal(scopedAllowed({ companyIds: ["c1"], siteIds: [] }, "c1", "s1"), false, "Company-only users receive no Labour workers");
assert.equal(scopedAllowed({ companyIds: [], siteIds: ["s1"] }, "c1", "s1"), false, "Site-only users receive no Labour workers");

const vendorOptionsRoute = fs.readFileSync("app/api/labour/contractors/vendor-options/route.ts", "utf8");
assert.match(vendorOptionsRoute, /requireLabourPermission\(request,\s*"labour_contractors",\s*"add"\)/, "Vendor options must use labour_contractors:add");
assert.doesNotMatch(vendorOptionsRoute, /labour_workers",\s*"view"/, "Vendor options must not depend on labour_workers:view");
assert.match(vendorOptionsRoute, /\.from\("vendors"\)/, "Vendor options must load from Vendor Master");
assert.match(vendorOptionsRoute, /\.from\("labour_contractor_profiles"\)/, "Vendor options must exclude already-enabled contractor profiles");
assert.match(vendorOptionsRoute, /\.neq\("status",\s*"deleted"\)/, "Vendor options should exclude deleted vendors");

const contractorPage = fs.readFileSync("app/labour/contractors/page.tsx", "utf8");
assert.match(contractorPage, /\/api\/labour\/contractors\/vendor-options/, "Contractor page must use contractor-specific vendor options endpoint");
assert.match(contractorPage, /lookupError/, "Contractor page must show vendor lookup errors");
assert.match(contractorPage, /No eligible vendors available\./, "Contractor page must show an eligible-vendors empty state");
assert.match(contractorPage, /disabled=\{!form\.vendor_id \|\| saving\}/, "Enable button must require a selected vendor");

const contractorRoute = fs.readFileSync("app/api/labour/contractors/route.ts", "utf8");
assert.match(contractorRoute, /requireLabourPermission\(request,\s*MODULE,\s*"add"\)/, "Contractor POST must require labour_contractors:add");
assert.match(contractorRoute, /Vendor is already enabled as a Labour Contractor\./, "Contractor POST should return a clear duplicate-vendor error");
assert.match(contractorRoute, /Contractor code already exists\./, "Contractor POST should return a clear duplicate-code error");

const workerCreateRoute = fs.readFileSync("app/api/labour/workers/route.ts", "utf8");
const workerRegisterRoute = fs.readFileSync("app/api/labour/workers/register/route.ts", "utf8");
const workerBatchRegisterRoute = fs.readFileSync("app/api/labour/workers/batch-register/route.ts", "utf8");
const workerUpdateRoute = fs.readFileSync("app/api/labour/workers/[id]/route.ts", "utf8");
const workerCreatePage = fs.readFileSync("app/labour/workers/new/page.tsx", "utf8");
const workerEditPage = fs.readFileSync("app/labour/workers/[id]/edit/page.tsx", "utf8");
const workerDetailPage = fs.readFileSync("app/labour/workers/[id]/page.tsx", "utf8");
const workerListPage = fs.readFileSync("app/labour/workers/page.tsx", "utf8");
const workerRateRoute = fs.readFileSync("app/api/labour/workers/[id]/wage-rates/route.ts", "utf8");
const deploymentRoute = fs.readFileSync("app/api/labour/workers/[id]/deployments/route.ts", "utf8");
const lookupsRoute = fs.readFileSync("app/api/labour/lookups/route.ts", "utf8");
const commercialShared = fs.readFileSync("app/api/labour/_shared.ts", "utf8");
const contractorDetailPage = fs.readFileSync("app/labour/contractors/[id]/page.tsx", "utf8");
const labourTradesPage = fs.readFileSync("app/labour/trades/page.tsx", "utf8");
const labourTradesRoute = fs.readFileSync("app/api/labour/trades/route.ts", "utf8");
const labourTradeIdRoute = fs.readFileSync("app/api/labour/trades/[id]/route.ts", "utf8");
const labourConstants = fs.readFileSync("lib/labour/constants.ts", "utf8");

assert.doesNotMatch(workerCreateRoute, /Company and site are required\./, "Worker master create must not require company/site");
assert.doesNotMatch(workerCreateRoute, /validateCompanySite/, "Worker master create must not validate company/site");
assert.match(workerCreateRoute, /const TECHNICAL_WORKER_TYPE = "contractor_labour"/, "Worker master API keeps contractor_labour as the technical stored value");
assert.match(workerCreateRoute, /Worker Type is not a supported Labourer Master option\./, "Worker master API rejects unsupported client-supplied worker types");
assert.match(workerCreateRoute, /Contractor is required\./, "Worker master create always requires contractor");
assert.match(workerCreateRoute, /validateTrade/, "Worker master create validates Labour Category against master");
assert.match(workerCreateRoute, /labour_trade_id: tradeCheck\.trade\?\.id/, "Worker master create stores Labour Category ID");
assert.match(workerCreateRoute, /worker_type: TECHNICAL_WORKER_TYPE/, "Worker master create ignores UI worker type and stores the technical contractor-labour value");
assert.match(workerCreateRoute, /current_company_id: null/, "Worker master create leaves current company snapshot empty");
assert.match(workerCreateRoute, /current_site_id: null/, "Worker master create leaves current site snapshot empty");
assert.match(workerCreateRoute, /current_work_order_id: null/, "Worker master create leaves current work-order snapshot empty");
assert.doesNotMatch(workerCreateRoute, /applyCompanySiteScope\(query,\s*access\.assignments,\s*"current_company_id"/, "Worker list must not scope by nullable current deployment fields");
assert.match(workerCreateRoute, /\.from\("labour_workers"\)[\s\S]+current_company_id, current_site_id, current_work_order_id, created_at[\s\S]+`, \{ count: "exact" \}\)/, "Worker list starts from Labourer Master rows");
assert.match(workerCreateRoute, /applyLabourWorkerScope\(query,\s*access\.assignments\)/, "Worker list requires both assigned company and site scope");
assert.match(workerCreateRoute, /current_company_id.*current_site_id/, "Worker list uses current company and site fields for authorization");
assert.match(workerCreateRoute, /current_deployment/, "Worker list API enriches workers with active deployment details");
assert.match(workerCreateRoute, /labour_deployments/, "Worker list API loads active deployment rows separately");
assert.match(workerCreateRoute, /contractor_name/, "Worker list API returns readable contractor name");
assert.match(workerCreateRoute, /labour_category_name/, "Worker list API returns readable Labour Category name");
assert.match(workerCreateRoute, /current_company_name/, "Worker list API returns readable current company name");
assert.match(workerCreateRoute, /current_site_name/, "Worker list API returns readable current site name");
assert.match(workerCreateRoute, /current_assignment_number/, "Worker list API returns readable MWO or Commercial WO number");
assert.match(workerCreateRoute, /current_payment_model/, "Worker list API returns readable current payment model source");
assert.match(workerCreateRoute, /count: count \|\| 0/, "Worker list API returns explicit count key");
assert.match(workerCreateRoute, /total: count \|\| 0/, "Worker list API preserves total key compatibility");

assert.match(workerCreatePage, /Labour Registration/, "Worker create page is now the Labour Registration workflow");
assert.match(workerCreatePage, /Register up to 5 Aadhaar cards for one contractor assignment/, "Registration page explains the batch Aadhaar workflow");
assert.match(workerCreatePage, /<h2 className="text-lg font-semibold">Assignment<\/h2>/, "Registration page has the approved Assignment section");
assert.match(workerCreatePage, /Identity Verification/, "Registration page has the approved identity verification section");
assert.doesNotMatch(workerCreatePage, /Assignment Summary/, "Registration page removes the duplicate Assignment Summary card");
assert.match(workerCreatePage, /company_id/, "Registration page collects assignment company");
assert.match(workerCreatePage, /site_id/, "Registration page collects assignment site");
assert.match(workerCreatePage, /vendor_id/, "Registration page collects Labour Contractor from the linked Vendor Master");
assert.match(workerCreatePage, /options=\{lookups\.vendors \|\| \[\]\} labelKey="vendor_name"/, "Registration contractor dropdown displays active Vendor Master rows");
assert.match(workerCreatePage, /labour_trade_id/, "Registration page collects assignment Labour Category");
assert.match(workerCreatePage, /effective_from/, "Registration page collects assignment effective date");
assert.match(workerCreatePage, /Site Joining Date \*/, "Registration page labels the assignment date as Site Joining Date");
assert.doesNotMatch(workerCreatePage, /<Select label="Status"|LABOUR_STATUSES/, "Registration page does not expose Status");
assert.doesNotMatch(workerCreatePage, /document_type", "Photo"/, "Batch Registration does not treat Aadhaar as the worker profile photo");
assert.match(workerCreatePage, /\/api\/labour\/workers\/register/, "Registration page uses the registration endpoint");
assert.match(workerCreatePage, /checkRow/, "Registration page checks each reviewed row for existing labour automatically");
assert.doesNotMatch(workerCreatePage, /confirmTransfer/, "Registration page does not ask the site user to choose transfer/reuse");
assert.match(workerCreatePage, /This labourer is already registered at the selected site\./, "Registration page detects same-site existing labour without duplicate deployment");
assert.match(workerCreatePage, /A possible existing labourer requires supervisor review\./, "Registration page blocks ambiguous identity matches for review");
assert.match(workerCreatePage, /Existing Labour — Transfer Required/, "Registration review shows transfer-required rows without asking reuse/create questions");
assert.match(workerCreatePage, /Successful rows are cleared for the next Aadhaar cards/, "Registration success returns the user to the Aadhaar capture/upload flow");
assert.match(workerCreatePage, /Today's Registered Labour/, "Registration success shows a compact running list instead of dashboard tiles");
assert.match(workerCreatePage, /Finish Batch/, "Registration success keeps Finish Batch");
assert.doesNotMatch(workerCreatePage, /Go to Site-In/, "Registration success does not link directly to Site-In");
assert.doesNotMatch(workerCreatePage, /Go to Mark Attendance|Today's Batch|Recent registrations|SummaryPill/, "Registration page removes the old batch dashboard and attendance shortcut");
assert.doesNotMatch(workerCreatePage, /Worker Type/, "Worker create page does not expose Worker Type");
assert.doesNotMatch(workerCreatePage, /WORKER_TYPES/, "Worker create page does not import Worker Type options");
assert.match(workerCreatePage, /Labour Category \*[\s\S]+lookups\.trades/, "Worker create page uses Category dropdown backed by Labour Categories");
assert.doesNotMatch(workerCreatePage, /<Input label="Labour Category"/, "Worker create page does not use free-text Labour Category");
assert.doesNotMatch(workerCreatePage, /UAN Number|ESI Number|Bank Account|IFSC|Bank Name|Skill Level/, "Worker create page keeps only approved Labourer Master fields");
assert.match(workerCreateRoute, /Labour Category is required\./, "Worker create requires Labour Category server-side");
assert.match(labourConstants, /export function normalizeLabourCode/, "Labour Code canonical normalization is centralized");
assert.match(workerRegisterRoute, /await nextLabourCode\(access\.admin, organizationId\)/, "Registration assigns the final Labour Code server-side");
assert.doesNotMatch(workerRegisterRoute, /normalizeLabourCode\(payload\.labour_code\) \|\| await nextLabourCode/, "Registration does not trust the client-predicted Labour Code for new workers");
assert.match(workerRegisterRoute, /workerError\.code !== "23505"/, "Registration retries generated Labour Code inserts on unique conflicts");
assert.match(workerRegisterRoute, /Could not generate a unique Labour Code\. Please try again\./, "Registration returns a clear error if automatic code generation cannot find a unique code");
assert.match(workerRegisterRoute, /from\("labour_workers"\)[\s\S]+\.select\("labour_code"\)[\s\S]+\.eq\("organization_id", organizationId\)[\s\S]+\.order\("labour_code", \{ ascending: false \}\)[\s\S]+\.limit\(1\)/, "Labour Code generation scopes all statuses and reads only the highest code");
assert.match(workerCreateRoute, /normalizeLabourCode\(payload\.labour_code\)/, "Worker create stores canonical Labour Code");
assert.match(workerCreateRoute, /assertUniqueLabourCode/, "Worker create checks canonical Labour Code duplicates");
assert.match(workerCreateRoute, /A labourer with this code already exists\./, "Worker create returns the approved canonical duplicate message");
assert.match(workerRegisterRoute, /validateLabourCompanySiteIndependent/, "Registration validates Labour company and site independently");
assert.doesNotMatch(workerRegisterRoute, /validateCompanySite/, "Registration does not reintroduce strict company-owned-site validation");
assert.match(workerRegisterRoute, /loadExistingWorker/, "Registration checks for existing labour by Aadhaar or approved strong identity");
assert.match(workerRegisterRoute, /normalizeIdentifier\(input\.aadhaarNumber\)/, "Registration normalizes Aadhaar for exact matching");
assert.match(workerRegisterRoute, /normalizeMobile\(input\.mobileNumber\)/, "Registration normalizes mobile for exact matching");
assert.doesNotMatch(workerRegisterRoute, /confirm_transfer_required/, "Registration endpoint no longer requires a site-user transfer choice");
assert.match(workerRegisterRoute, /confidence: "definite"/, "Registration matcher treats exact Aadhaar as a definite match");
assert.match(workerRegisterRoute, /confidence: "strong"/, "Registration matcher supports unambiguous strong multi-field matches");
assert.doesNotMatch(workerRegisterRoute, /matchType: "mobile_name"/, "Registration matcher no longer treats mobile plus name alone as a strong match");
assert.match(workerRegisterRoute, /"name_father_dob"/, "Registration matcher treats name plus father\/husband plus DOB as a strong match");
assert.match(workerRegisterRoute, /"name_father_mobile"/, "Registration matcher treats name plus father\/husband plus mobile as a strong match");
assert.match(workerRegisterRoute, /conflict: true/, "Registration matcher blocks conflicting or ambiguous identity matches");
assert.match(workerRegisterRoute, /weak: true/, "Registration matcher returns non-blocking weak duplicate awareness");
assert.match(workerRegisterRoute, /already_registered/, "Registration detects the same current assignment without duplicate deployment");
assert.match(workerRegisterRoute, /createRegistrationDeployment/, "Registration creates initial assignment or transfer through the registration-only deployment helper");
assert.match(workerRegisterRoute, /wage_rate: input\.wageRate/, "Registration stores Daily Rate on labour_deployments");
assert.match(workerRegisterRoute, /commercial_model: "daily_wage"/, "Registration does not require Work Order selection for ordinary site registration");
assert.match(deploymentRoute, /Contract-basis deployment requires a Commercial Work Order\./, "Dedicated deployment changes still enforce Commercial WO for contract-basis deployments");
assert.match(workerRegisterRoute, /nextLabourCode/, "Registration endpoint generates the next Labour Code");
assert.match(workerRegisterRoute, /LAB\$?\{String\(max \+ 1\)\.padStart\(6, "0"\)\}/, "Registration endpoint uses LAB000001-style numbering");
assert.match(workerRegisterRoute, /ensureContractorProfile/, "Registration can create a minimal contractor compatibility profile from Vendor Master");
assert.match(workerRegisterRoute, /assertSameOrgVendor/, "Registration validates the selected Vendor through existing organization scope");
assert.match(workerRegisterRoute, /vendor_id: vendorId/, "Registration links compatibility contractor profiles back to Vendor Master");
assert.match(workerRegisterRoute, /work_order_id: null/, "Registration does not attach a Commercial Work Order");
assert.match(workerRegisterRoute, /manpower_work_order_id: null/, "Registration does not attach a Manpower Work Order");
assert.match(workerRegisterRoute, /Labour registered successfully and assigned to/, "Registration returns the approved assignment success message");
assert.match(workerRegisterRoute, /A labourer with this code already exists\./, "Registration preserves global Labour Code uniqueness");
assert.match(workerRegisterRoute, /loadScopedWorker/, "Explicit existing-worker transfers use scoped worker loading");

assert.doesNotMatch(workerUpdateRoute, /Company and site are required\./, "Worker edit must not require company/site");
assert.match(workerUpdateRoute, /validateTrade/, "Worker edit validates Labour Category against master");
assert.match(workerUpdateRoute, /Worker Type is not a supported Labourer Master option\./, "Worker edit API rejects unsupported client-supplied worker types");
assert.match(workerUpdateRoute, /worker_type: TECHNICAL_WORKER_TYPE/, "Worker edit stores the technical contractor-labour value");
assert.doesNotMatch(workerEditPage, /current_company_id/, "Worker edit page does not edit company as master data");
assert.doesNotMatch(workerEditPage, /current_site_id/, "Worker edit page does not edit site as master data");
assert.doesNotMatch(workerEditPage, /Worker Type/, "Worker edit page does not expose Worker Type");
assert.doesNotMatch(workerEditPage, /WORKER_TYPES/, "Worker edit page does not import Worker Type options");
assert.match(workerEditPage, /Labour Category[\s\S]+lookups\.trades/, "Worker edit page uses Labour Category dropdown");
assert.doesNotMatch(workerEditPage, /UAN Number|ESI Number|Bank Account|IFSC|Bank Name|Skill Level/, "Worker edit page keeps only approved Labourer Master fields");
assert.match(workerUpdateRoute, /Labour Category is required\./, "Worker edit requires Labour Category server-side");
assert.match(workerUpdateRoute, /assertUniqueIdentity/, "Worker edit blocks duplicate Aadhaar and identity numbers server-side");
assert.match(workerUpdateRoute, /assertUniqueLabourCode/, "Worker edit checks canonical Labour Code duplicates excluding the current worker");
assert.match(workerUpdateRoute, /Labour Code cannot be changed\./, "Worker edit preserves the current disabled Labour Code workflow");

assert.match(lookupsRoute, /purpose === "labour_deployment"/, "Lookup API supports Labour Deployment purpose");
assert.match(lookupsRoute, /purpose === "labour_registration"/, "Lookup API supports Labour Registration purpose");
assert.match(lookupsRoute, /purpose === "labour_deployment" \? \["approved"\]/, "Labour Deployment lookups return only approved MWOs");
assert.match(workerDetailPage, /\/api\/labour\/lookups\?purpose=labour_deployment/, "Worker detail uses deployment-specific lookups");
assert.doesNotMatch(workerDetailPage, /\/api\/labour\/attendance\/daily|\/api\/labour\/attendance\/day-lock/, "Worker detail does not call Labour Attendance APIs");
assert.match(workerDetailPage, /const deploymentSites = lookups\.sites \|\| \[\]/, "Deployment site dropdown is independent from selected company");
assert.doesNotMatch(workerDetailPage, /site\.company_id === deploymentForm\.company_id/, "Deployment UI does not filter sites by company");
assert.match(workerDetailPage, /Payment Model/, "Deployment UI labels Daily Wage and Contract Basis as Payment Model");
assert.match(workerDetailPage, /Current Assignment/, "Worker detail shows a Current Assignment card");
assert.match(workerDetailPage, /Admin Deployment Tool/, "Worker detail keeps deployment tooling as admin compatibility");
assert.match(workerDetailPage, /Create Initial Deployment/, "Worker detail still supports admin initial deployment tooling when undeployed");
assert.match(workerDetailPage, /Transfer \/ Change Deployment/, "Worker detail modal still supports transfer action for admin compatibility");
assert.match(workerDetailPage, /New deployment must start after/, "Worker detail explains transfer date rule before save");
assert.match(deploymentRoute, /New deployment must start after the current deployment start date\./, "Deployment API rejects same-day or backdated transfer attempts");
assert.match(deploymentRoute, /overlapQuery = overlapQuery\.neq\("id", openDeployment\.id\)/, "Deployment API excludes the current open deployment from overlap precheck");
assert.match(deploymentRoute, /Another deployment already exists for the selected effective date\./, "Deployment API returns a specific conflict message for other overlapping deployments");
assert.match(workerDetailPage, /commercial_model === "daily_wage"[\s\S]+Approved Manpower Work Order[\s\S]+Select Approved MWO/, "Daily Wage deployment shows approved MWO selector");
assert.match(workerDetailPage, /commercial_model === "contract_basis"[\s\S]+Commercial Work Order/, "Contract Basis deployment shows Commercial WO selector");
assert.match(workerDetailPage, /loadCommercialWorkOrders/, "Contract Basis deployment loads Commercial WOs from a context-specific lookup");
assert.match(workerDetailPage, /contractor_profile_id[\s\S]+company_id[\s\S]+site_id/, "Commercial WO lookup sends contractor, company and site context");
assert.match(workerDetailPage, /Loading approved Commercial Work Orders\.\.\./, "Contract Basis modal shows Commercial WO loading state");
assert.match(workerDetailPage, /No approved Commercial Work Order available/, "Contract Basis modal shows disabled no-data option");
assert.match(workerDetailPage, /No approved Commercial Work Order is linked to this contractor for the selected company and site\./, "Contract Basis modal shows compact no-data explanation");
assert.match(workerDetailPage, /deploymentError/, "Deployment submission errors use modal-local error state");
assert.match(workerDetailPage, /setDeploymentError\(payload\.error \|\| "Failed to save deployment\."\)/, "Deployment API errors render inside the modal");
assert.doesNotMatch(workerDetailPage, /if \(!response\.ok\) return setError\(payload\.error \|\| "Failed to save deployment\."\)/, "Deployment save does not use the page-level alert");
assert.match(workerDetailPage, /commercial_model === "daily_wage" && <Info label="Daily Rate"/, "Worker detail shows Daily Rate only for Daily Wage deployments");
assert.match(workerDetailPage, /formatCurrency\(currentDeployment\.daily_rate\)/, "Worker detail formats missing Daily Rate as Not Set instead of zero");
assert.doesNotMatch(workerDetailPage, /Resolved Daily Wage Rate:|Resolved OT Rate|OT Rate|OT rate/, "Worker detail does not expose resolved or OT-rate controls");
assert.match(workerDetailPage, /No approved MWO available[\s\S]+Create & approve an MWO for the selected site\./, "Daily Wage modal shows compact no-approved-MWO empty state");
assert.match(workerDetailPage, /function workOrderLabel\(workOrder: any\)[\s\S]+wo_number[\s\S]+wo_type[\s\S]+Not Assigned/, "Worker detail formats Work Order as WO Number and WO Type with a Not Assigned fallback");
assert.match(workerDetailPage, /<Info label="Work Order" value=\{workOrderLabel\(currentDeployment\.work_orders \|\| worker\.current_work_orders\)\}/, "Current Assignment shows the current Work Order with the clear label");
assert.doesNotMatch(workerDetailPage, /label=\{currentDeployment\.commercial_model === "daily_wage" \? "MWO" : "Commercial WO"\}/, "Current Assignment no longer shows the unclear MWO or Commercial WO label");
assert.match(workerDetailPage, /Transfer History[\s\S]+\["Company", "Site", "Model", "Work Order", "Category", "From", "To", "Status", "Reason"\]/, "Transfer history renders Work Order as the approved history column");
assert.match(workerDetailPage, /deployments\.map[\s\S]+assignmentLabel\(deployment\)/, "Transfer history uses each deployment row's own Work Order label");
assert.match(workerUpdateRoute, /work_orders\(id, wo_number, wo_type\)/, "Worker detail API returns Work Order number and type for each deployment");
assert.match(workerUpdateRoute, /current_work_orders: currentWorkOrder \|\| null/, "Worker detail API returns the worker current Work Order lookup");
assert.doesNotMatch(workerDetailPage, /Card title="Advances"|saveAdvance|\/api\/labour\/advances\?worker_id/, "Worker detail does not expose worker-specific advances");
assert.match(workerDetailPage, /currentDeployment \? "Transfer Reason \*" : "Reason \(Optional\)"/, "Worker deployment form makes transfer reason mandatory and initial deployment reason optional");
assert.doesNotMatch(workerDetailPage, /Work Order optional/, "Daily Wage MWO dropdown does not show Commercial Work Orders");
assert.doesNotMatch(workerDetailPage, /Worker Type/, "Worker detail does not expose Worker Type as master data");
assert.doesNotMatch(workerDetailPage, /Advanced: Worker-Specific Rate Override|showRateOverride|Reason for override|wage-rates/, "Worker detail does not expose worker-specific wage overrides");
assert.match(workerRateRoute, /Reason is required for worker-specific rate overrides\./, "Worker-specific rate override API requires a reason");
assert.match(deploymentRoute, /validateCommercialWorkOrderForContractor/, "Deployment API validates Contract Basis Commercial WO with contractor context");
assert.match(deploymentRoute, /contractor\.vendor_id/, "Deployment API uses contractor profile canonical Vendor ID");
assert.match(deploymentRoute, /\.eq\("approval_status", "approved"\)|workOrder\.approval_status !== "approved"/, "Deployment API requires approved Commercial WOs");
assert.match(deploymentRoute, /\.from\("work_order_vendors"\)[\s\S]+\.eq\("vendor_id", contractor\.vendor_id\)/, "Deployment API requires Work Order vendor linkage");
assert.match(deploymentRoute, /workOrder\.company_id !== input\.companyId[\s\S]+workOrder\.site_id !== input\.siteId/, "Deployment API validates independent selected company and site on the Work Order");
assert.match(lookupsRoute, /loadCommercialWorkOrdersForDeployment/, "Lookup API has a deployment-specific Commercial WO loader");
assert.match(lookupsRoute, /\.from\("work_order_vendors"\)[\s\S]+\.eq\("vendor_id", contractor\.vendor_id\)/, "Lookup API loads Commercial WOs through Work Order vendor links");
assert.match(lookupsRoute, /loadCommercialWorkOrdersForDeployment[\s\S]+\.eq\("approval_status", "approved"\)|loadCommercialWorkOrdersForDeployment[\s\S]+workOrder\.approval_status !== "approved"/, "Deployment-specific Commercial WO lookup remains approved-only");
assert.match(lookupsRoute, /loadWorkOrderContractorsForCompanySite/, "Lookup API has a company/site Work Order contractor loader");
assert.match(lookupsRoute, /\.from\("work_order_vendors"\)[\s\S]+\.in\("work_order_id", workOrderIds\)/, "Labour Registration lookups resolve contractors through Work Order vendor links");
assert.doesNotMatch(lookupsRoute, /\.from\("work_orders"\)[\s\S]+\.in\("approval_status"/, "Labour Registration Commercial WO contractor source does not hide unapproved Work Order vendors");
assert.doesNotMatch(lookupsRoute, /loadWorkOrderContractorsForCompanySite[\s\S]+\.eq\("approval_status"/, "Labour Registration and Site-In contractor source does not use approved-only Commercial WO filtering");
assert.match(lookupsRoute, /\.from\("manpower_work_orders"\)[\s\S]+\.eq\("company_id", input\.companyId\)[\s\S]+\.eq\("site_id", input\.siteId\)[\s\S]+\.in\("status", \["draft", "pending", "submitted", "approved"\]\)/, "Labour Registration lookups keep temporary MWO contractor source without approved-only filtering");
assert.match(lookupsRoute, /vendors\.map\(\(vendor: any\) => \(\{[\s\S]+id: vendor\.id[\s\S]+vendor_id: vendor\.id/, "Lookup API exposes Vendor-backed contractor options even without contractor profiles");
assert.match(lookupsRoute, /vendors: workOrderContractors \? workOrderContractors\.vendors : vendors\.data \|\| \[\]/, "Lookup API returns Work Order-linked vendors for Labour Registration");

assert.match(workerCreatePage, /Capture Aadhaar/, "Registration starts worker entry with Aadhaar capture");
assert.match(workerCreatePage, /Upload Aadhaar/, "Registration allows Aadhaar upload for camera-unfriendly devices");
assert.match(workerCreatePage, /\/api\/labour\/workers\/ocr/, "Registration uses the server-side Aadhaar OCR endpoint");
assert.match(workerBatchRegisterRoute, /Aadhaar Front[\s\S]+Aadhaar Back/, "Captured Aadhaar front/back sides are saved as worker documents");
assert.match(workerCreatePage, /aadhaar_front_file_\$\{row\.id\}[\s\S]+aadhaar_back_file_\$\{row\.id\}/, "Registration keeps each Aadhaar side linked to its reviewed row");
assert.match(workerBatchRegisterRoute, /uploadWorkerDocument/, "Batch Registration reuses the existing worker document API handler");
assert.match(workerBatchRegisterRoute, /document_type", upload\.type/, "Batch Registration attaches each Aadhaar file using its side-specific document label");
for (const documentType of ["Aadhaar", "PAN", "Voter ID", "Driving Licence", "Bank Passbook", "ESIC Card", "PF / UAN", "Medical Certificate", "Police Verification", "Other"]) {
  assert.match(labourConstants, new RegExp(`"${documentType.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`), `Labour documents support ${documentType}`);
}

assert.match(workerListPage, /\["Labour Code", "Labour Name", "Father\/Husband", "Contractor", "Category", "Current Company", "Current Site", "Mobile", "Status", "Actions"\]/, "Worker list shows the approved Labour Registration columns");
assert.match(workerListPage, /Not Deployed/, "Worker list shows Not Deployed for undeployed worker assignment fields");
assert.match(workerCreateRoute, /current_deployment/, "Worker list API returns active deployment details when present");
assert.match(workerListPage, /filters\.site_id/, "Worker list includes the Site filter");
assert.match(workerListPage, /current_site_name \|\| "Not Deployed"/, "Worker list renders current site from active deployment summary");
assert.match(workerListPage, /setError\(payload\.error \|\| "Failed to load labourers\."\)/, "Worker list displays API errors");
assert.match(workerListPage, /!workers\.length && !error/, "Worker list shows empty state only after successful empty response");
assert.match(workerListPage, /payload\.workers/, "Worker list page reads the API workers key");
assert.doesNotMatch(workerListPage, /MWO \/ Work Order|current_assignment_number|payment_model|Daily Rate|maskAadhaar\(worker\.aadhaar_number\)/, "Worker list hides operational assignment, rate and Aadhaar columns");
assert.match(workerListPage, /placeholder="Search code, name, father\/husband, mobile or Aadhaar"/, "Worker list search still supports Aadhaar search text");
assert.doesNotMatch(workerListPage, /Direct Labour/, "Worker list does not expose unsupported direct-labour terminology");
assert.match(commercialShared, /labour_trades:labour_trade_id/, "Worker detail loader returns canonical Labour Category relation");
assert.match(workerUpdateRoute, /This labourer is already in use and cannot be deleted\. Mark them Inactive instead\./, "Referenced Labourers cannot be hard-deleted");
assert.match(workerUpdateRoute, /payload\.status_only === true/, "Worker update API supports status-only changes without requiring deployment fields");
assert.match(workerUpdateRoute, /Changed labourer \${current\.labour_code} status from/, "Status-only worker changes are audited");
assert.match(workerListPage, /changeWorkerStatus/, "Labour directory exposes authorised worker status management");
assert.match(workerListPage, /status_only: true/, "Labour directory status changes use the status-only API path");
assert.match(workerListPage, /This changes only the worker master status, not deployment/, "Reactivating from directory does not create or transfer deployment");
assert.doesNotMatch(workerUpdateRoute, /labour_deployments"\)\.select\("id", \{ count: "exact", head: true \}\)\.eq\("labour_worker_id", id\)/, "Worker delete guard no longer blocks registration-only deployment rows");
assert.doesNotMatch(workerUpdateRoute, /labour_documents"\)\.select\("id", \{ count: "exact", head: true \}\)\.eq\("labour_worker_id", id\)/, "Worker delete guard no longer blocks document-only registration/import records");
assert.match(workerUpdateRoute, /labour_attendance[\s\S]+labour_site_ins[\s\S]+labour_site_in_engineer_assignments[\s\S]+labour_work_group_members[\s\S]+labour_wage_rates[\s\S]+labour_wage_lines[\s\S]+labour_advances[\s\S]+labour_overtime_requests/, "Worker delete guard still blocks operational references");
assert.match(workerDetailPage, /const tabs = \["Overview", "Documents", "Transfer History", "Activity"\]/, "Worker detail uses the approved compact tabs");
assert.match(workerDetailPage, /activityLimit/, "Worker activity limits initial rows");
assert.match(workerDetailPage, /View Details/, "Worker activity keeps details collapsed");
assert.match(workerDetailPage, /Profile photo uploaded successfully\./, "Worker profile photo refreshes after upload");
assert.match(labourConstants, /export function formatLabourCode/, "Labour code display uses a shared formatter");
assert.match(workerListPage, /formatLabourCode\(worker\.labour_code\)/, "Worker list displays three-digit Labour Codes");
assert.match(workerDetailPage, /formatLabourCode\(worker\.labour_code\)/, "Worker detail displays three-digit Labour Codes");
assert.match(workerListPage, /photo_url[\s\S]+worker\.worker_name/, "Worker list shows compact photo/avatar beside worker name");
assert.match(workerCreateRoute, /labour_documents[\s\S]+document_type", "Photo"[\s\S]+photo_url/, "Worker list API returns signed active profile photo URLs");
assert.match(workerUpdateRoute, /labour_contractor_profiles[\s\S]+vendors\(vendor_name\)/, "Worker detail API enriches the linked contractor name");
assert.match(workerDetailPage, /contractorName \|\| "Not Assigned"/, "Worker detail shows Not Assigned when no linked contractor name exists");
assert.match(workerUpdateRoute, /resolveDailyRate/, "Worker detail API resolves Daily Wage rate for display");
assert.match(workerUpdateRoute, /workerRateValue[\s\S]+mwoRateValue[\s\S]+deployment\.wage_rate/, "Daily Rate display uses worker override, then MWO rate, then deployment snapshot");
assert.match(workerListPage, /canDelete = global \|\| can\(permissions, "labour_workers", "delete"\)/, "Worker list delete button requires labour_workers:delete");
assert.match(workerDetailPage, /canDelete = global \|\| can\(permissions, "labour_workers", "delete"\)/, "Worker detail delete button requires labour_workers:delete");
assert.match(workerListPage, /method: "DELETE"/, "Worker list calls the safe delete API");
assert.match(workerDetailPage, /method: "DELETE"/, "Worker detail calls the safe delete API");

assert.match(deploymentRoute, /validateIndependentCompanySite/, "Deployment API validates company and site independently for Labour");
assert.match(deploymentRoute, /Transfer reason must be at least 10 characters\./, "Deployment API enforces meaningful transfer reason only when changing deployment");
assert.doesNotMatch(deploymentRoute, /const scopeCheck = await validateCompanySite/, "Deployment API does not use strict company-owned-site validation");
assert.match(deploymentRoute, /commercialModel === "contract_basis"[\s\S]+validateCommercialWorkOrderForContractor/, "Commercial WO validation remains contract-basis only");
assert.match(deploymentRoute, /mwo\.status !== "approved"/, "Daily Wage deployment requires approved MWO");
assert.match(deploymentRoute, /manpower_work_order_rates/, "Daily Wage deployment resolves category rate from MWO rate history");
assert.match(deploymentRoute, /Selected Manpower Work Order does not have an active rate/, "Daily Wage deployment blocks missing MWO category rates");
assert.match(deploymentRoute, /labour_trade_id: tradeCheck\.trade\?\.id/, "Deployment stores Labour Category ID after transfer");
assert.match(deploymentRoute, /wage_rate: commercialModel === "daily_wage" \? resolvedMwoRate\?\.daily_rate/, "Daily Wage deployment derives wage rate from MWO");
assert.match(commercialShared, /site\.company_id !== companyId/, "Shared Commercial-style company-site validation remains strict for other workflows");
assert.match(contractorDetailPage, /\["Date", "User", "Action", "Changed", "Reason", "Details"\]/, "Contractor activity log uses compact columns");
assert.match(contractorDetailPage, /activityChanges\(log\)/, "Contractor activity log summarizes readable field-level changes");
assert.match(contractorDetailPage, /slice\(0, activityLimit\)/, "Contractor activity log limits initial rows");
assert.match(contractorDetailPage, /View Details/, "Contractor activity log keeps raw details collapsed");
assert.doesNotMatch(contractorDetailPage, /Old Values.*New Values/, "Contractor activity log does not render raw old/new payload columns");

assert.match(labourTradesPage, /Add Category/, "Labour Categories page uses a compact add action");
assert.match(labourTradesPage, /\["Code", "Category", "Description", "Status", "Usage", "Actions"\]/, "Labour Categories list shows the approved columns");
assert.match(labourTradesPage, /Search name, code or description/, "Labour Categories page searches name, code and description");
assert.match(labourTradesPage, /usageLabel\(trade\.usage_count\)/, "Labour Categories page displays usage from the API");
assert.match(labourTradesPage, /Rates are maintained in Manpower Work Orders\./, "Labour Categories page keeps rates outside the master modal");
assert.doesNotMatch(labourTradesPage, /Daily Rate|OT Rate|Hourly Rate|Wage History|Rate Revisions|Worker Overrides/, "Labour Categories page does not expose rate or wage settings");
assert.match(labourTradesRoute, /requireLabourPermission\(request,\s*MODULE,\s*"view"\)/, "Labour Categories GET requires view permission");
assert.match(labourTradesRoute, /requireLabourPermission\(request,\s*MODULE,\s*"add"\)/, "Labour Categories POST requires add permission");
assert.match(labourTradeIdRoute, /requireLabourPermission\(request,\s*MODULE,\s*"edit"\)/, "Labour Categories PUT requires edit permission");
assert.match(labourTradeIdRoute, /requireLabourPermission\(request,\s*MODULE,\s*"delete"\)/, "Labour Categories DELETE requires delete permission");
assert.match(labourTradesRoute, /A labour category with this name already exists\./, "Labour Categories POST has specific duplicate-name message");
assert.match(labourTradesRoute, /A labour category with this code already exists\./, "Labour Categories POST has specific duplicate-code message");
assert.match(labourTradeIdRoute, /This category is already in use and cannot be deleted\. Mark it Inactive instead\./, "Referenced Labour Categories cannot be deleted");
assert.match(labourTradeIdRoute, /labour_workers[\s\S]+labour_deployments[\s\S]+manpower_work_order_rates[\s\S]+labour_wage_rates/, "Labour Categories delete guard checks operational references");
assert.match(labourTradesRoute, /\.from\("labour_workers"\)[\s\S]+\.in\("labour_trade_id", tradeIds\)/, "Labour Categories usage count is loaded in one batched query");
assert.match(lookupsRoute, /\.from\("labour_trades"\)\.select\("id, organization_id, trade_name, trade_code, status"\)\.eq\("status", "active"\)/, "New Labour lookups expose only active categories");

console.log("Labour foundation rule tests passed.");
