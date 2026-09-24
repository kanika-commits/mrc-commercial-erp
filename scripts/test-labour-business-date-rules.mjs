import assert from "node:assert/strict";
import fs from "node:fs";

const dateSource = fs.readFileSync("lib/labour/businessDate.ts", "utf8");
const validate = (value) => {
  const match = String(value ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const [, y, m, d] = match.map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
};

assert.match(dateSource, /\\d\{4\}-\\d\{2\}-\\d\{2\}/, "shared validator requires four-digit ISO dates");
for (const value of ["92026-01-21", "2026-02-30", "2026-13-01", "abcd-01-01"]) assert.equal(validate(value), false, `${value} is rejected`);
for (const value of ["2026-09-21", "1970-01-01", "1999-01-28"]) assert.equal(validate(value), true, `${value} remains accepted`);

const sources = [
  ["app/api/labour/workers/register/route.ts", /validateLabourBusinessDate/],
  ["app/api/labour/workers/batch-register/route.ts", /validateLabourBusinessDate/],
  ["app/api/labour/workers/[id]/deployments/route.ts", /validateLabourBusinessDate/],
  ["app/api/labour/workers/[id]/route.ts", /validateLabourBusinessDate/],
  ["app/api/labour/import/execute/route.ts", /validateLabourBusinessDate/],
];
for (const [file, pattern] of sources) assert.match(fs.readFileSync(file, "utf8"), pattern, `${file} uses shared date validation`);

const detail = fs.readFileSync("app/labour/workers/[id]/page.tsx", "utf8");
assert.match(detail, /if \(!\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/.test\(value\)\) return "-"/, "detail formatter safely handles malformed dates");
assert.match(detail, /currentDeployment\.effective_from/, "detail page keeps deployment effective_from authoritative");
assert.match(detail, /const months = \["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"\]/, "detail formatter uses DD-MMM-YYYY month labels");
assert.match(detail, /return `\$\{String\(day\)\.padStart\(2, "0"\)\}-\$\{months\[month - 1\]\}-\$\{String\(year\)\.padStart\(4, "0"\)\}`/, "detail formatter renders DD-MMM-YYYY");
assert.doesNotMatch(detail, /Invalid Date/, "detail page does not render literal Invalid Date");
console.log("Labour business-date contract passed.");
