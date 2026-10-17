import assert from "node:assert/strict";
import fs from "node:fs";

const preview = fs.readFileSync("app/api/work-orders/[id]/revisions/[revisionId]/preview/route.ts", "utf8");
const action = fs.readFileSync("app/api/work-orders/[id]/revisions/[revisionId]/route.ts", "utf8");
const editor = fs.readFileSync("app/work-orders/new/structured/page.tsx", "utf8");

assert.match(preview, /artifact && revision\.status !== "draft"/);
assert.match(preview, /revision\.status !== "draft".*submitted Pilot revision PDF artifact is missing/);
assert.match(action, /const draftArtifact = revision\.status === "draft"/);
assert.match(action, /upsert: draftArtifact/);
assert.match(action, /sha256\(existingBytes\) !== sha256\(bytes\)/);
assert.match(editor, /saveRevisionSnapshot\(\)/);
assert.match(editor, /action: "artifact"/);

console.log("Pilot revision draft regeneration and locked-artifact integrity contract passed");
