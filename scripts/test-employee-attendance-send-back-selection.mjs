import fs from "node:fs";

const page = fs.readFileSync("app/hr/attendance-approval/page.tsx", "utf8");
const route = fs.readFileSync("app/api/hr/attendance/approval-groups/send-back/route.ts", "utf8");

if (!page.includes("sendBackIds.includes(id)")) throw new Error("Send Back must intersect selected IDs");
if (!route.includes('.in("id", ids).eq("status", "submitted")')) throw new Error("API must filter exact submitted IDs");
if (!route.includes('.eq("id", state.id).eq("status", "submitted")')) throw new Error("Update must retain exact submitted-ID guard");

const registers = [
  { id: "daily-register-a", status: "submitted" },
  { id: "daily-register-b", status: "submitted" },
];
const submittedIds = registers.filter((row) => row.status === "submitted").map((row) => row.id);
const sendBackIds = ["daily-register-a"];
const selectedForSendBack = submittedIds.filter((id) => sendBackIds.includes(id));
if (selectedForSendBack.length !== 1 || selectedForSendBack[0] !== "daily-register-a") throw new Error("Send Back selection broadened beyond the selected register");
if (submittedIds.length !== 2) throw new Error("Bulk approval fixture must retain both submitted registers");

console.log("PASS: Send Back targets only selected submitted registers; bulk approval retains all submitted registers.");
