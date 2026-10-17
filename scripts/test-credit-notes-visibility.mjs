import assert from "node:assert/strict";
import fs from "node:fs";

const shell = fs.readFileSync("components/AppShell.tsx", "utf8");
const modules = fs.readFileSync("app/modules/page.tsx", "utf8");
const modulePage = fs.readFileSync("components/ModulePage.tsx", "utf8");
const navigation = fs.readFileSync("lib/defaultModuleNavigation.ts", "utf8");
const permissions = fs.readFileSync("lib/permissionMatrix.ts", "utf8");
const presentation = fs.readFileSync("lib/permissionVisibility.ts", "utf8");

assert.match(shell, /navLeaf\("Credit Notes", "credit_notes", "\/credit-notes"\)/);
assert.doesNotMatch(shell, /Credit Note Approvals/);
assert.match(modules, /checkModules: \["ra_bills", "debit_notes", "credit_notes", "ra_approval"\]/);
assert.match(modulePage, /can\(permissions, page\.module_code, "view"\)/);
assert.match(shell, /globalAccess \|\| can\(permissions, moduleCode, "view"\)/);
assert.match(navigation, /module_code: "credit_notes"[\s\S]*?route: "\/credit-notes"/);
assert.match(permissions, /credit_notes: \["view", "add", "edit", "delete"\]/);
assert.match(presentation, /credit_notes: \{ visible_group: "Project Management"/);

console.log("Credit Note sidebar and module-card visibility contract passed.");
