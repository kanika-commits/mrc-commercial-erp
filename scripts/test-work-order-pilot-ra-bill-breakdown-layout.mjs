import fs from "node:fs";
const source = fs.readFileSync("app/forms/pilot/ra-bills/new/page.tsx", "utf8");
if (!source.includes("<tr key={child.id}") || !source.includes("Breakdown description") || !source.includes("childResult?.current_amount")) throw new Error("Breakdown rows are not rendered as complete table rows");
if (!source.includes('className="min-w-[1500px] w-full')) throw new Error("Breakdown table lost horizontal scrolling");
for (const token of ['child.cumulative_qty', 'child.release_percent', 'child.remarks', 'removeChild(row.serial, child.id)']) if (!source.includes(token)) throw new Error(`Missing aligned child column: ${token}`);
console.log("Pilot RA Bill breakdown table-row layout contract passed");
