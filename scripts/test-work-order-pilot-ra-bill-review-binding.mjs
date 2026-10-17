import assert from "node:assert/strict";
import { pilotRaBillReviewBindingHash } from "../lib/workOrderPilotRaBillReviewBinding.ts";

const base = { billId: "bill", organizationId: "org", workOrderId: "wo", withheld: 10, labourCess: 5, calculationSnapshot: { current_basic: 100, total_debit_notes: 2, total_credit_notes: 3, adjusted_net_payable: 86 } };
const unchanged = pilotRaBillReviewBindingHash(base);
assert.equal(unchanged, pilotRaBillReviewBindingHash({ ...base, calculationSnapshot: { ...base.calculationSnapshot } }));
assert.notEqual(unchanged, pilotRaBillReviewBindingHash({ ...base, withheld: 11 }));
assert.notEqual(unchanged, pilotRaBillReviewBindingHash({ ...base, labourCess: 6 }));
assert.notEqual(unchanged, pilotRaBillReviewBindingHash({ ...base, calculationSnapshot: { ...base.calculationSnapshot, total_debit_notes: 7 } }));
assert.notEqual(unchanged, pilotRaBillReviewBindingHash({ ...base, calculationSnapshot: { ...base.calculationSnapshot, total_credit_notes: 8 } }));
console.log("Pilot RA Bill review binding regression passed.");
