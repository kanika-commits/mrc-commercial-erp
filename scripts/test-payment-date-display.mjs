import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

const source = fs.readFileSync("lib/payments/formatPaymentDate.ts", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const module = { exports: {} };
new Function("module", "exports", compiled)(module, module.exports);
const { formatPaymentDate } = module.exports;

assert.equal(formatPaymentDate("2026-06-10"), "10 Jun 2026");
assert.equal(formatPaymentDate("2026-11-07"), "07 Nov 2026");
assert.equal(formatPaymentDate("2026-09-20"), "20 Sep 2026");
assert.equal(formatPaymentDate("62026-06-10"), "62026-06-10");
assert.equal(formatPaymentDate("2026-02-30"), "2026-02-30");
assert.equal(formatPaymentDate(""), "-");

console.log("Payment date display tests passed.");
