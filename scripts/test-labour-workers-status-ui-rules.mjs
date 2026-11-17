import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync("app/labour/workers/page.tsx", "utf8");

assert.match(page, /grid min-w-0 grid-cols-1/);
assert.match(page, /table className="min-w-\[1180px\] text-sm"/);
assert.match(page, /\["Labour Code", "Labour Name"[\s\S]+"Status", "Actions"\]/);
assert.match(page, /<select value=\{worker\.status\} onChange=\{\(event\) => changeWorkerStatus\(worker, event\.target\.value\)\}/);
assert.match(page, /<td className="whitespace-nowrap px-3 py-3">[\s\S]*changeWorkerStatus/);
assert.match(page, /<td className="whitespace-nowrap px-3 py-3">[\s\S]*> View<\/Link>/);

console.log("Labour worker status UI rules passed");
