import assert from "node:assert/strict";
import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8");
const login = read("app/login/page.tsx");
const guard = read("components/AuthGuard.tsx");
const userHeader = read("components/UserHeader.tsx");

assert.match(login, /window\.location\.hostname\.toLowerCase\(\) === "platform\.siteqube\.com"/);
assert.match(login, /roleCodes\?\.includes\("platform_owner"\)/);
assert.match(login, /router\.push\("\/platform"\)/);
assert.match(login, /Platform Owner access required/);
assert.match(login, /router\.push\("\/"\)/);

assert.match(guard, /function isPlatformHost\(\)/);
assert.match(guard, /pathname === "\/"\) return !access\.roleCodes\.includes\("platform_owner"\)/);
assert.match(guard, /router\.replace\("\/platform"\)/);
assert.match(guard, /pathname === "\/" && accessDenied && access && !isPlatformHost\(\)/);

assert.match(userHeader, /window\.location\.href = "\/login"/);
assert.doesNotMatch(userHeader, /siteqube\.com.*location/);

console.log("SiteQube platform host routing rules: PASS");
