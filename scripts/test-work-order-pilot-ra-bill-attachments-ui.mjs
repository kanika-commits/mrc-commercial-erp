import fs from "node:fs";
const page = fs.readFileSync("app/forms/pilot/ra-bills/new/page.tsx", "utf8");
for (const token of ["<PilotAttachments ref={attachmentRef} billId={saved?.id} />", "＋ Attach supporting documents", "Click to choose files or drag and drop them here", "onDrop", "multiple", "file.original_file_name", "file.status === \"draft\"", "Staged for review", "Remove"]) if (!page.includes(token)) throw new Error(`Missing attachment UI contract: ${token}`);
console.log("Pilot RA Bill attachment visibility contract passed");
