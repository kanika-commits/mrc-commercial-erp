import fs from "node:fs";

const api = fs.readFileSync("app/api/work-orders/pilot-ra-bills/route.ts", "utf8");
const helper = fs.readFileSync("lib/workOrderPilotRaBill.ts", "utf8");
const form = fs.readFileSync("app/forms/pilot/ra-bills/new/page.tsx", "utf8");

for (const token of [
  'work_order_pilot_ra_bill_items(*)',
  'revision_snapshot',
  'previousLine?.breakdowns',
  'priorById',
  'child.id',
  'crypto.randomUUID()',
  'requires breakdown reconciliation',
]) if (!api.includes(token)) throw new Error(`Missing history safeguard: ${token}`);

for (const token of ['previous_amount', 'current_amount', 'children.reduce', 'cumulative_amount'])
  if (!helper.includes(token)) throw new Error(`Missing child calculation contract: ${token}`);

if (!form.includes('crypto.randomUUID()') || !form.includes('breakdowns: line?.breakdowns || []'))
  throw new Error("Breakdown identity is not preserved through draft reopen");

console.log("Pilot RA Bill breakdown history contract passed");
