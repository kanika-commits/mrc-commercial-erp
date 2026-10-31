import fs from "node:fs";
const page=fs.readFileSync("app/forms/pilot/ra-bills/new/page.tsx","utf8"); const route=fs.readFileSync("app/api/work-orders/pilot-ra-bills/route.ts","utf8");
for (const token of ["RA Bill No.", "Select a Work Order to suggest a number", "disabled={!workOrderId}", "setBillNumber", "bill_number: billNumber"]) if (!page.includes(token)) throw new Error(`Missing number field contract: ${token}`);
for (const token of ['get("lookup") === "number"', "loadDatabaseRaBills", 'from("ra_bills")', 'from("work_order_pilot_ra_bills")', 'eq("organization_id", organizationId)', 'eq("work_order_id", workOrderId)', "isRejected", "approval_status", "creation_request_id", "databaseRaNumberParts", "RA-\\d{3,}", "already used for this Work Order"]) if (!route.includes(token)) throw new Error(`Missing server numbering contract: ${token}`);
if (route.includes("listDriveFolderFiles") || route.includes("GOOGLE_DRIVE_DOWNLOAD_WEB_APP_URL")) throw new Error("Pilot numbering must not depend on Drive folder listing.");
if (route.includes('...(tombstones || []).map')) throw new Error("Deleted Pilot tombstones must not reserve RA numbers");
console.log("Pilot RA Bill number field and suggestion contract passed");
