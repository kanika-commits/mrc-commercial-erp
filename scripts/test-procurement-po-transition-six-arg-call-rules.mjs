import assert from "node:assert/strict";
import fs from "node:fs";

const route = fs.readFileSync("app/api/procurement/purchase-orders/[id]/route.ts", "utf8");

assert.match(route, /rpc\("transition_procurement_purchase_order_atomic",\s*\{[\s\S]*p_purchase_order_id: id[\s\S]*p_organization_id: result\.row\.organization_id[\s\S]*p_action: action[\s\S]*p_actor: actor\(result\.auth\)[\s\S]*p_note: text\(body\.note\) \|\| null[\s\S]*p_freeze_projection: null/);

console.log("PO transition six-argument call rules: PASS");
