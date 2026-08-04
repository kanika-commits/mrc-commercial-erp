import assert from "node:assert/strict";
import fs from "node:fs";

const validateSource = fs.readFileSync(new URL("../app/api/labour/import/validate/route.ts", import.meta.url), "utf8");
const previewSource = fs.readFileSync(new URL("../app/api/labour/import/preview/route.ts", import.meta.url), "utf8");
const pageSource = fs.readFileSync(new URL("../app/labour/workers/import/page.tsx", import.meta.url), "utf8");
const mappingRoute = fs.readFileSync(new URL("../app/api/labour/import/mapping/route.ts", import.meta.url), "utf8");

function assertContains(source, needle, message) {
  assert.ok(source.includes(needle), message);
}

assertContains(validateSource, "const MASTER_MAPPING_KEY = \"__master_mappings\"", "Labour import validation must use the shared master mapping JSON key");
assertContains(validateSource, "masterMappingValue(mapping, group, rawSource)", "saved master mapping is checked before automatic lookup");
assertContains(validateSource, "if (mappedId) {", "mapped IDs take precedence over name/code matching");
assertContains(validateSource, "return { status: \"resolved\", record: mappedRecord, method: \"mapped\", mappedId }", "mapped records resolve directly without ambiguity lookup");
assertContains(validateSource, "matches.length === 0", "automatic lookup has a not-found branch");
assertContains(validateSource, "matches.length > 1", "automatic lookup has an ambiguous branch");
assertContains(validateSource, "Please map it from ERP Master Value Mapping", "ambiguous automatic matches direct users to saved mapping");
assertContains(validateSource, "company_name: companyResolution.record?.company_name", "mapped preview data stores resolved company name");
assertContains(validateSource, "site_name: siteResolution.record?.site_name", "mapped preview data stores resolved site name");
assertContains(validateSource, "contractor_name: matchedContractor?.vendors?.vendor_name", "mapped preview data stores resolved contractor name");
assertContains(validateSource, "trade_name: matchedTrade?.trade_name", "mapped preview data stores resolved trade name");
assertContains(validateSource, "contractor_vendor_id: matchedContractor?.vendor_id", "mapped contractor vendor ID survives into execution payload");
assertContains(validateSource, "labour_trade_id: matchedTrade?.id", "mapped trade ID survives into execution payload");
assertContains(validateSource, "master_mapping_status", "row-level mapping status is persisted for review");

assertContains(previewSource, "master_options", "preview API exposes ERP master options for the mapping UI");
assertContains(previewSource, "companies", "preview API includes company mapping options");
assertContains(previewSource, "sites", "preview API includes site mapping options");
assertContains(previewSource, "contractors", "preview API includes contractor mapping options");
assertContains(previewSource, "trades", "preview API includes labour category/trade mapping options");
assertContains(previewSource, "vendors(id, vendor_name, status)", "preview API must select only real vendor columns for contractor mapping");
assert.ok(!previewSource.includes("vendor_code"), "Labour Import contractor preview must not reference non-existent vendors.vendor_code");
assertContains(previewSource, "code: contractor.contractor_code || \"\"", "contractor mapping options should use labour contractor profile code when a code is shown");
assertContains(previewSource, "access.admin.from(\"vendors\").select(\"id, vendor_name, contractor_type, status\")", "contractor mapping options include active Vendor Master rows even before compatibility profiles exist");
assertContains(previewSource, "profile_id: null", "vendor-only contractor mapping options remain explicit about missing compatibility profiles");

assertContains(pageSource, "ERP Master Value Mapping", "Labour Import page renders master mapping UI");
assertContains(pageSource, "Save Mapping & Continue", "mapping save advances into the worker-preview stage");
assertContains(pageSource, "Review each worker and the document links from that same workbook row before document access", "saved mapping does not skip the visible worker preview/permission flow");
assertContains(pageSource, "validateBatch(batchId)", "document checking still recalculates ready/invalid counts after permission");
assertContains(pageSource, "[MASTER_MAPPING_KEY]: masterMappingDraft", "UI saves master mappings under the shared key");
assertContains(pageSource, "Auto match by name/code", "unmapped values continue to use automatic matching");
assertContains(pageSource, "n.company_name || n.company_text", "preview table displays resolved ERP company name");
assertContains(pageSource, "n.site_name || n.site_text", "preview table displays resolved ERP site name");
assertContains(pageSource, "n.contractor_name || row.contractor_text", "preview table displays resolved ERP contractor name");
assertContains(pageSource, "n.labour_category || n.employment_category", "preview table displays workbook Labour Category separately from ERP trade");
assertContains(pageSource, "n.trade_name || n.trade", "preview table displays resolved ERP trade name");
assertContains(pageSource, "rowMessage ? rowMessage.replace", "document badges must show row-specific filename matching errors");
assertContains(pageSource, "issueMessage || sourceName || entry?.original_file_name || \"Matched\"", "matched document badges must show filenames without contradictory failure text");

assertContains(mappingRoute, "const currentMapping = mappingObject(batch.mapping)", "mapping route must preserve existing document-folder metadata");
assertContains(mappingRoute, "mapping: { ...currentMapping, ...incomingMapping }", "mapping route must merge ERP master mappings into the current mapping object");

console.log("Labour import master mapping tests passed.");
