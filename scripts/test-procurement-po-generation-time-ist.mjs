import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);
const ts = require("typescript");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "po-generation-time-"));
const helperPath = path.join(temp, "poGenerationTime.mjs");
const helperSource = fs.readFileSync(path.join(root, "lib/procurement/poGenerationTime.ts"), "utf8");
const helperJs = ts.transpileModule(helperSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
fs.writeFileSync(helperPath, helperJs);

const { formatPoGenerationTime } = await import(helperPath);
const timestamp = "2026-09-22T06:00:00Z";
const expected = "22 Sep 2026, 11:30 AM";

process.env.TZ = "UTC";
assert.equal(formatPoGenerationTime(timestamp), expected, "UTC host timezone must not affect PO generation time");
process.env.TZ = "America/Los_Angeles";
assert.equal(formatPoGenerationTime(timestamp), expected, "non-India host timezone must not affect PO generation time");
assert.equal(formatPoGenerationTime("not-a-timestamp"), "-");

const route = fs.readFileSync(path.join(root, "app/api/procurement/purchase-orders/[id]/pdf/route.ts"), "utf8");
assert.match(route, /import \{ formatPoGenerationTime \} from "@\/lib\/procurement\/poGenerationTime"/);
assert.match(route, /isDraft \? formatPoGenerationTime\(new Date\(\)\) : null/);

console.log("PO generation time India timezone regression passed.");
