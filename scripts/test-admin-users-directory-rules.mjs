import fs from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const page = fs.readFileSync(`${root}/app/admin/users/page.tsx`, "utf8");
const mustInclude = [
  "Search users by name or email",
  "All Roles",
  "All Status",
  "All Companies",
  "All Sites",
  "Name A–Z",
  "Name Z–A",
  "Showing ${filteredRows.length} of ${profiles.length} users",
  "All Companies",
  "All Sites",
  "Edit Access",
  "bg-white",
  "border-slate-300",
  "whitespace-nowrap",
  "md:hidden",
  "Company Access",
  "Site Access",
  "Delete",
  "tenant-primary-bg",
  "No users match your search or filters.",
  "profile.full_name",
  "profile.email",
  "row.roleNames",
  "created-newest",
  "platform_owner",
  "globalAccess",
];
for (const marker of mustInclude) {
  if (!page.includes(marker)) throw new Error(`Admin Users directory missing ${marker}`);
}
if (page.includes("bg-blue-600") || page.includes("bg-[#04779e]")) throw new Error("Legacy primary button color remains");
if (page.includes("rows.some((row) => !row.company_id)") || page.includes("rows.some((row) => !row.site_id)")) throw new Error("Null scope fields must not be inferred as wildcard access");
console.log("Admin Users directory focused rules: PASS");
