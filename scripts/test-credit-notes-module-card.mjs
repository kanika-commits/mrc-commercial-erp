import assert from "node:assert/strict";
import fs from "node:fs";

const modulePage = fs.readFileSync("components/ModulePage.tsx", "utf8");
const sidebar = fs.readFileSync("components/AppShell.tsx", "utf8");
const creditNotesPage = fs.readFileSync("app/credit-notes/page.tsx", "utf8");

assert.match(modulePage, /groupCode === "project_management"/);
assert.match(modulePage, /can\(permissions, "credit_notes", "view"\)/);
assert.match(modulePage, /module_name: "Credit Notes"/);
assert.match(modulePage, /route: "\/credit-notes"/);
assert.match(sidebar, /navLeaf\("Credit Notes", "credit_notes", "\/credit-notes"\)/);
assert.match(creditNotesPage, /<h1 className="text-3xl font-bold">Credit Notes<\/h1>/);
assert.doesNotMatch(modulePage, /module_code: "debit_notes"[\s\S]*module_name: "Credit Notes"/);

console.log("Credit Notes Project Management card contract passed.");
