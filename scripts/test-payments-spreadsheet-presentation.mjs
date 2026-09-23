import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);
const ts = require("typescript");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "payments-grid-"));
const modulePath = path.join(temp, "paymentGrid.mjs");
const source = fs.readFileSync(path.join(root, "lib/payments/paymentGrid.ts"), "utf8");
fs.writeFileSync(modulePath, ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText);
const {
  mapPaymentGridPaste,
  matchPaymentOption,
  normalizePaymentDate,
  filterPaymentRegisterRows,
  transferredPaymentAmount,
} = await import(modulePath);

const mapped = mapPaymentGridPaste(
  "Axis Ltd\tWork Order\tWO-104 — Civil\tHDFC • ****4821\tA Vendor\t2026-09-22\t12500\t500\t12000\nSecond Co\tFuel\tFuel bill\tICICI • ****0099\tDriver\t2026-09-23\t900\t0\t900",
  2,
  0,
);
assert.equal(mapped.length, 2, "multi-row spreadsheet paste creates one mapping per row");
assert.equal(mapped[0].values.company, "Axis Ltd");
assert.equal(mapped[0].values.payment_type, "Work Order");
assert.equal(mapped[0].values.reference, "WO-104 — Civil");
assert.equal(mapped[1].values.total_payment, "900");
assert.ok(!("transferred_amount" in mapped[0].values), "calculated transferred amount is never paste-mapped");

const readOnlyStart = mapPaymentGridPaste("12000\tRemove", 0, 8);
assert.deepEqual(readOnlyStart[0].values, {}, "calculated and action columns cannot be changed by paste");

const companyOptions = [{ id: "company-1", name: "Axis Ltd", code: "AX" }];
assert.equal(matchPaymentOption("AX - Axis Ltd", companyOptions, (option) => [option.name, option.code, `${option.code} - ${option.name}`])?.id, "company-1");
assert.equal(matchPaymentOption("Unknown Company", companyOptions, (option) => [option.name, option.code]), null, "unresolved lookup text is rejected instead of created");
assert.equal(normalizePaymentDate("18/09/2026"), "2026-09-18", "Indian spreadsheet dates map to date inputs");
assert.equal(normalizePaymentDate("9/22/2026"), "2026-09-22", "US-formatted spreadsheet dates are also recognized");
assert.equal(normalizePaymentDate("not a date"), null, "invalid pasted dates are rejected");

assert.equal(transferredPaymentAmount("12500", "500"), 12000, "existing total minus TDS calculation remains unchanged");
const registerRows = [
  { company_id: "company-1", payment_type: "Work Order", party: "A Vendor", account_name: "HDFC • ****4821", payment_date: "2026-09-22", status: "paid" },
  { company_id: "company-2", payment_type: "Fuel", party: "Driver", account_name: "ICICI • ****0099", payment_date: "2026-09-23", status: "pending" },
];
assert.deepEqual(filterPaymentRegisterRows(registerRows, { companyId: "company-1", paymentType: "Work Order", party: "A Vendor", fromAccount: "HDFC • ****4821", dateFrom: "2026-09-22", dateTo: "2026-09-22", status: "paid" }), [registerRows[0]], "the legacy helper remains behaviorally stable while the register toolbar uses the server filters");
const entryPage = fs.readFileSync(path.join(root, "app/payments/new/page.tsx"), "utf8");
const registerPage = fs.readFileSync(path.join(root, "app/payments/page.tsx"), "utf8");
const registerApi = fs.readFileSync(path.join(root, "app/api/payments/register/route.ts"), "utf8");
assert.match(entryPage, /handleWorkOrderSelect/);
assert.match(entryPage, /function handleCompanySelect\(index: number, companyId: string\)/, "company changes still use the row-aware company handler");
assert.match(entryPage, /updateRow\(index, "payment_type"/);
assert.match(entryPage, /handleInvoiceSelect/);
assert.match(entryPage, /company_bank_account_id/);
assert.match(entryPage, /updateRow\(index, "payment_date"/);
assert.match(entryPage, /updateRow\(index, "total_payment"/);
assert.match(entryPage, /updateRow\(index, "tds_amount"/);
assert.match(entryPage, /const transfer = total - tds/);
assert.match(entryPage, /function removeRow\(index: number\)/);
assert.match(entryPage, /\+ Add 10 Rows/);
assert.match(entryPage, /function savePayments\(\)/);
assert.match(entryPage, /event\.key === "Tab"/, "Tab and Shift+Tab move between editable grid cells");
assert.match(entryPage, /event\.key === "Enter"/, "Enter advances through editable grid cells");
assert.match(entryPage, /\["ArrowUp", "ArrowDown"\]/, "vertical arrow navigation is limited to text fields");
assert.match(entryPage, /fetch\("\/api\/payments"/);
assert.match(registerPage, /can\(access\?\.permissions \|\| \[\], "payments", "delete"\)/, "existing register permission control remains");
assert.match(registerPage, /\/api\/payments\/register\?/);
assert.match(registerPage, /page: String\(page \+ 1\)/, "register pagination remains wired");
assert.match(registerPage, /params\.set\("search", search\)/, "server-side register search remains wired");
assert.match(registerPage, /params\.set\("company_id"/);
assert.match(registerPage, /params\.set\("payment_type"/);
assert.match(registerPage, /params\.set\("party"/);
assert.match(registerPage, /params\.set\("from_account"/);
assert.match(registerPage, /params\.set\("date_from"/);
assert.match(registerPage, /params\.set\("date_to"/);
assert.match(registerPage, /params\.set\("created_by"/);
assert.match(registerPage, /Created By[\s\S]*All Users/);
assert.doesNotMatch(registerPage, /filters\.status|All Statuses|filters the rows on the current page/);
assert.match(registerPage, /result\.filter_options/);
assert.match(registerApi, /FILTER_OPTIONS_PAGE_SIZE = 500/);
assert.match(registerApi, /\.from\("profiles"\)[\s\S]*\.select\("email, full_name"\)/);
assert.match(registerApi, /created_by_display:[\s\S]*created_by_name[\s\S]*created_by_email/);
assert.match(registerApi, /function applyPaymentFilters[\s\S]*filters\.dateFrom[\s\S]*filters\.dateTo[\s\S]*filters\.createdBy/);
assert.match(registerApi, /filter_options: filterOptions/);

console.log("Payments spreadsheet presentation and behavior contracts passed.");
