import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("components/NotificationCenter.tsx", "utf8");

assert.match(source, /const previousIds = knownIdsRef\.current/);
assert.match(source, /if \(previousIds && \[\.\.\.nextIds\]\.some\(\(id\) => !previousIds\.has\(id\)\)\) beep\(\)/);
assert.match(source, /knownIdsRef\.current = nextIds/);
assert.match(source, /localStorage\.getItem\("erp-notification-sound"\) === "on"/);
assert.match(source, /localStorage\.setItem\("erp-notification-sound", next \? "on" : "off"\)/);
assert.match(source, /try \{[\s\S]*context\.close\(\)[\s\S]*\} catch/);

console.log("Notification sound lifecycle contract passed");
