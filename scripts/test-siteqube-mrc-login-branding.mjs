import assert from "node:assert/strict";
import fs from "node:fs";

const login = fs.readFileSync("app/login/page.tsx", "utf8");
const logo = fs.readFileSync("public/branding/mrc-group-logo.png");

assert.match(login, /MRC_LOGIN_HOSTNAME = "mrc\.siteqube\.com"/);
assert.match(login, /logoUrl: "\/branding\/mrc-group-logo\.png"/);
assert.match(login, /primaryColor: "#9b2428"/);
assert.match(login, /secondaryColor: "#741f24"/);
assert.match(login, /function brandingForHost\(hostname: string, branding: TenantBranding\)/);
assert.match(login, /isMrcLoginHost\(hostname\) \? resolveTenantBranding/);
assert.match(login, /isMrcLogin \? "bg-\[#f7f3f1\]" : "bg-slate-100"/);
assert.match(login, /isMrcLogin \? "lg:w-\[44%\]" : "lg:w-\[46%\]"/);
assert.match(login, /MRC Group workspace/);
assert.match(login, /Powered by SiteQube/);
assert.match(login, /window\.location\.hostname\.toLowerCase\(\) === "platform\.siteqube\.com"/);
assert.deepEqual([...logo.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);

console.log("MRC tenant login branding rules: PASS");
