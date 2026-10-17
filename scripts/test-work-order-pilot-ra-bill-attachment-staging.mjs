import fs from "node:fs";
const page = fs.readFileSync("app/forms/pilot/ra-bills/new/page.tsx", "utf8");
for (const token of ["multiple", "Staged for review", "setStaged"]) if (!page.includes(token)) throw new Error(`Missing attachment staging contract: ${token}`);
if (page.includes("Save the draft first to attach documents.")) throw new Error("New-bill flow still blocks attachment staging before draft creation");
if (!page.includes('action === "preview"') || !page.includes('setSaved(d.bill)')) throw new Error("Review PDF no longer saves the Pilot draft first");
if (!page.includes("await attachmentRef.current?.flush(d.bill.id)")) throw new Error("Review PDF does not await staged attachment upload and manifest verification");
if (!page.includes("/preview") || page.indexOf("flush(d.bill.id)") > page.indexOf("/preview")) throw new Error("PDF generation is not sequenced after attachment verification");
if (!page.includes("!reviewReady")) throw new Error("Submission is not gated on review readiness");
console.log("Pilot RA Bill pre-save attachment staging contract passed");
