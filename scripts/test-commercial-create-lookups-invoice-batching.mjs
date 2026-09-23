import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

const source = fs.readFileSync("lib/commercial/claimedInvoiceLookups.ts", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const module = { exports: {} };
new Function("module", "exports", compiled)(module, module.exports);
const { loadClaimedInvoicesForWorkOrders } = module.exports;

const queryRuns = [];
const admin = {
  from(table) {
    const run = { table, select: null, workOrderIds: null, status: null, order: null };
    queryRuns.push(run);
    const builder = {
      select(value) { run.select = value; return builder; },
      in(column, values) { assert.equal(column, "work_order_id"); run.workOrderIds = values; return builder; },
      ilike(column, value) { run.status = [column, value]; return builder; },
      order(column) { run.order = column; return builder; },
      then(resolve, reject) {
        const data = (run.workOrderIds || []).map((id) => ({ id: `invoice-${id}`, invoice_number: `INV-${id}` }));
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      },
    };
    return builder;
  },
};

const workOrderIds = Array.from({ length: 123 }, (_, index) => `wo-${index + 1}`);
const invoices = await loadClaimedInvoicesForWorkOrders(admin, workOrderIds);

assert.equal(queryRuns.length, 3, "123 work orders should be split into bounded requests");
assert.deepEqual(queryRuns.map((query) => query.workOrderIds.length), [50, 50, 23]);
assert.deepEqual(queryRuns.flatMap((query) => query.workOrderIds), workOrderIds);
for (const query of queryRuns) {
  assert.equal(query.table, "invoices");
  assert.equal(query.select, "id, invoice_number, work_order_id, vendor_id, invoice_amount, itc_status");
  assert.deepEqual(query.status, ["itc_status", "claimed"]);
  assert.equal(query.order, "invoice_number");
}
assert.equal(invoices.length, 123);
assert.equal(invoices[0].invoice_number, "INV-wo-1");

console.log("Create-lookups invoice batching tests passed.");
