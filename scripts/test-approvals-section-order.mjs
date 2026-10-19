import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync("app/approvals/page.tsx", "utf8");
const ra = page.indexOf('<h2 className="font-semibold text-slate-950">Pending RA Bills</h2>');
const debit = page.indexOf("Pending Debit Notes", ra);
const credit = page.indexOf("Pending Credit Notes", debit);

assert.ok(ra >= 0, "Pending RA Bills section is missing");
assert.ok(debit >= 0, "Pending Debit Notes section is missing");
assert.ok(credit >= 0, "Pending Credit Notes section is missing");
assert.ok(ra < debit && debit < credit, "Approval sections must be RA Bills, Debit Notes, then Credit Notes");
console.log("Approval section order: PASS");
