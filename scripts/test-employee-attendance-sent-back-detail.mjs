import fs from "node:fs";

const page = fs.readFileSync("app/hr/attendance-approval/page.tsx", "utf8");
const route = fs.readFileSync("app/api/hr/attendance/approval-groups/route.ts", "utf8");
const fixture = { organization_id: "org-1", site_id: "site-1", attendance_date: "2026-11-05", status: "reopened" };
const groupId = `${fixture.organization_id}:${fixture.site_id}:${fixture.attendance_date}`;
if (groupId !== "org-1:site-1:2026-11-05") throw new Error("Unexpected sent-back group identifier");
if (!route.includes('"reopened"')) throw new Error("Approval detail route must include reopened states");
if (!page.includes('period_status=${encodeURIComponent("all")}')) throw new Error("Detail loading must include sent-back states");
if (!page.includes("setDetailError")) throw new Error("Detail loading needs an explicit error state");
if (!page.includes("Retry loading approval details")) throw new Error("Detail errors need a retry action");
if (!page.includes("No attendance approval details found.")) throw new Error("Detail view needs an explicit empty state");
if (!page.includes("attendance_date=${encodeURIComponent(group.attendance_date)}")) throw new Error("Detail request must retain the date identifier");
console.log("PASS: sent-back detail identifier, reopened loading path, and error/retry/empty states.");
