import fs from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const read = (file) => fs.readFileSync(`${root}/${file}`, "utf8");
const files = {
  migration: read("supabase/migrations/202609070007_tenant_branding.sql"),
  adminApi: read("app/api/admin/branding/route.ts"),
  publicApi: read("app/api/branding/route.ts"),
  page: read("app/admin/branding/page.tsx"),
  login: read("app/login/page.tsx"),
  appShell: read("components/AppShell.tsx"),
};
const must = (file, patterns) => patterns.forEach((pattern) => {
  if (!files[file].includes(pattern)) throw new Error(`${file} missing ${pattern}`);
});
must("migration", ["organization_branding", "organization_id", "logo_path", "login_tagline", "tenant-branding-assets", "public)"]);
must("adminApi", ["loadPermissionContext", "platform_owner", "PUT", "POST", "DELETE", "recordAuditEvent", "image/png", "2 * 1024 * 1024", "branding", "logo", "Branding storage is not initialized yet."]);
must("publicApi", ["resolveCurrentOrganization", "createSignedReadUrl"]);
must("page", ["Branding", "Customize how your organization appears in SiteQube.", "Organization Logo", "Organization Name", "Primary Color", "Secondary Color", "Save Branding", "Remove Logo", "Login Preview", "createObjectURL", "revokeObjectURL", "object-contain", "apiFetch", "Clear Selection", "color", "HEX"]);
must("login", ["/api/branding", "signInWithPassword", "/api/admin/bootstrap", "router.push(\"/\")", "Powered by SiteQube", '"loading"', '"ready"', '"fallback"', "new Image()", "image.onload", "aria-busy", "animate-pulse"]);
must("appShell", ["TenantBrandingContext", "brandingStatus", "new Image()", "tenant-primary-foreground", "aria-busy", "animate-pulse"]);
if (files.appShell.indexOf("if (brandingStatus === \"loading\")") < files.appShell.indexOf("const moduleRouteByCode = useMemo")) throw new Error("AppShell branding loading return must remain below all hooks");
if ((files.appShell.match(/fetch\(\"\/api\/branding\"/g) || []).length !== 1) throw new Error("AppShell must have one shared branding fetch");
if (files.appShell.includes('>SQ</span>')) throw new Error("Collapsed AppShell must not render an SQ initials badge");
if (files.adminApi.includes("tenant_id") || files.publicApi.includes("tenant_id")) throw new Error("Tenant selection parameter leaked into branding APIs");
if (files.adminApi.includes("organization.organization_name") || files.publicApi.includes("organization.organization_name") || files.publicApi.includes("organizations.organization_name")) throw new Error("Invalid organization display column remains");
if (files.adminApi.includes("organizations.organization_name") || files.publicApi.includes("organizations.organization_name")) throw new Error("Invalid organization display column remains");
if (files.migration.includes("drop table") || files.migration.includes("delete from") || files.migration.includes("update public")) throw new Error("Destructive migration operation found");
if (files.page.includes('fetch("/api/admin/branding"')) throw new Error("Branding page bypasses the authenticated ERP API helper");
if (!files.adminApi.includes('status: 403') || !files.adminApi.includes('loadPermissionContext')) throw new Error("Branding API authorization contract is incomplete");
console.log("SiteQube tenant branding focused rules: PASS");
