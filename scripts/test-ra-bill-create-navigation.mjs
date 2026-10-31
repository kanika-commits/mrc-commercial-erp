import assert from "node:assert/strict";
import fs from "node:fs";

const modulePage = fs.readFileSync("components/ModulePage.tsx", "utf8");
const appShell = fs.readFileSync("components/AppShell.tsx", "utf8");
const register = fs.readFileSync("app/ra-bills/page.tsx", "utf8");
const form = fs.readFileSync("app/ra-bills/new/page.tsx", "utf8");

assert.match(modulePage, /groupCode === "project_management"/);
assert.match(modulePage, /can\(permissions, "ra_bills", "add"\)/);
assert.match(modulePage, /module_name: "RA Bills Form"/);
assert.match(modulePage, /route: "\/forms\/pilot\/ra-bills\/new"/);
assert.match(modulePage, /page\.module_name === "RA Bill Forms" \|\| page\.route === "\/ra-bills\/new"/);
assert.match(modulePage, /legacyRaBillForm\.module_name = "RA Bills Form"/);
assert.match(modulePage, /legacyRaBillForm\.route = "\/forms\/pilot\/ra-bills\/new"/);
assert.match(modulePage, /route === "\/forms\/pilot\/ra-bills\/new"/);
assert.match(appShell, /navActionLeaf\("RA Bills Form", "ra_bills", "add", "\/forms\/pilot\/ra-bills\/new"\)/);
assert.match(appShell, /navLeaf\("RA Bills", "ra_bills", "\/ra-bills"\)/);
assert.match(modulePage, /page\.route !== "\/forms\/pilot\/ra-bills"/);
assert.doesNotMatch(fs.readFileSync("lib/defaultModuleNavigation.ts", "utf8"), /module_name: "RA Bills \(Pilot\)"/);
assert.match(fs.readFileSync("app/forms/pilot/ra-bills/new/page.tsx", "utf8"), /\/api\/work-orders\/pilot-ra-bills\?lookup=work_orders/);
assert.match(fs.readFileSync("app/forms/pilot/ra-bills/new/page.tsx", "utf8"), /export default function NewPilotRaBillPage/);
assert.doesNotMatch(fs.readFileSync("app/forms/pilot/ra-bills/new/page.tsx", "utf8"), /redirect\("\/ra-bills\/new"\)/);
assert.match(register, /const canAdd = can\(access\?\.permissions \|\| \[\], "ra_bills", "add"\)/);
assert.match(register, /canAdd &&/);
assert.match(register, /href="\/ra-bills\/new"/);
assert.match(form, /export default function NewRABillPage/);

console.log("RA Bill create navigation and permission contract passed.");
