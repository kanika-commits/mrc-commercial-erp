import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync("app/purchase/purchase-orders/new/page.tsx", "utf8");

assert.match(page, /const companyTerms = useMemo\(\(\) => \(lookups\.terms_templates \|\| \[\]\)\.filter\(\(row: any\) => row\.company_id === companyId/, "terms are scoped to the selected company");
assert.match(page, /const selectedTerms = companyTerms\.find\(\(row: any\) => row\.id === termsTemplateId\) \|\| null;/, "selected template is authoritative");
assert.match(page, /companyTerms\.some\(\(row: any\) => row\.id === current\) \? current : companyTerms\.find\(\(row: any\) => row\.is_default\)/, "default only initializes an empty or invalid selection");
assert.match(page, /setTermsTemplateId\(event\.target\.value\)/, "manual selection updates the authoritative template ID");
assert.doesNotMatch(page, /selectedTerms = companyTerms\.find\([\s\S]*\) \|\| companyTerms\.sort/, "selected template does not fall back to a display-only default");
assert.match(page, /if \(!selectedTerms \|\| standardTerms\.trim\(\)\) return;/, "terms content derives from the selected template without overwriting edits");
assert.match(page, /standard_terms_template_id: selectedTerms\?\.id \|\| null/, "payload uses the selected template ID");
assert.match(page, /standard_terms_sections: selectedTerms\?\.sections/, "payload uses sections from the selected template");
assert.match(page, /setTermsTemplateId\(""\);[\s\S]*setStandardTerms\(""\);/, "company changes clear the previous company selection and content");

console.log("Purchase Order terms-template selection rules: PASS");
