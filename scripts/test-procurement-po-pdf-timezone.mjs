import assert from "node:assert/strict";
import fs from "node:fs";

const pdfRoute = fs.readFileSync("app/api/procurement/purchase-orders/[id]/pdf/route.ts", "utf8");
assert.match(pdfRoute, /const draftGeneratedAt = isDraft \? new Intl\.DateTimeFormat\("en-GB", \{[\s\S]*timeZone: "Asia\/Kolkata"[\s\S]*\}\)\.format\(new Date\(\)\)/);

const instant = new Date("2026-10-17T11:49:00.000Z");
const formatted = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true,
  timeZone: "Asia/Kolkata",
}).format(instant);
assert.equal(formatted, "17/10/2026, 05:19 pm");
assert.notEqual(formatted, new Intl.DateTimeFormat("en-GB", {
  day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true,
  timeZone: "UTC",
}).format(instant));

console.log("Purchase Order PDF generated timestamp timezone contract passed");
