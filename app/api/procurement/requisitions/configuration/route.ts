import { NextResponse } from "next/server";
import { adminClient, applyCompanySiteAccess, applyOrganizationAccess, jsonError, requireProcurementPermission, text } from "@/lib/serverProcurementAccess";
import { hasServerPermission } from "@/lib/serverPermissions";

const MODULE = "purchase_requisition_approval_configuration";
const defaults = ["Billing Engineer Verification", "Project Manager Approval", "Final Approval"];

async function scope(auth: any, admin: any, companyId: string, siteId: string) {
  const company = await admin.from("companies").select("id,organization_id,company_name").eq("id", companyId).maybeSingle();
  const site = await admin.from("sites").select("id,organization_id,site_name").eq("id", siteId).maybeSingle();
  if (company.error) throw company.error; if (site.error) throw site.error;
  if (!company.data || !site.data || company.data.organization_id !== site.data.organization_id) return null;
  if (!auth.isGlobalAccess && !(auth.roleCodes || []).includes("platform_owner")) {
    if (!(auth.organizations || []).includes(company.data.organization_id)) return null;
    if ((auth.companies || []).length && !(auth.companies || []).includes(companyId)) return null;
    if ((auth.sites || []).length && !(auth.sites || []).includes(siteId)) return null;
  }
  return { company: company.data, site: site.data, organizationId: company.data.organization_id };
}

export async function GET(request: Request) {
  try {
    const auth = await requireProcurementPermission(request, MODULE, "view"); if ("response" in auth) return auth.response;
    const sp = new URL(request.url).searchParams; const companyId = text(sp.get("company_id")); const siteId = text(sp.get("site_id")); const admin = adminClient();
    let companies = applyOrganizationAccess(admin.from("companies").select("id,organization_id,company_name,company_code,status").neq("status","deleted").order("company_name"), auth);
    let sites = applyOrganizationAccess(admin.from("sites").select("id,organization_id,site_name,site_code,status").neq("status","deleted").order("site_name"), auth);
    if (!companies || !sites) return NextResponse.json({ configurations: null, companies: [], sites: [], approvers: [] });
    if ((auth.companies || []).length) companies = companies.in("id", auth.companies); if ((auth.sites || []).length) sites = sites.in("id", auth.sites);
    const [c, s] = await Promise.all([companies, sites]); if (c.error) throw c.error; if (s.error) throw s.error;
    let configuration = null; let configurations: any[] = []; let approvers: any[] = [];
    const allConfigs = applyOrganizationAccess(admin.from("purchase_requisition_approval_configurations").select("*").eq("status", "active").order("updated_at", { ascending: false }), auth);
    if (allConfigs) {
      let scopedConfigs: any = allConfigs;
      if ((auth.companies || []).length) scopedConfigs = scopedConfigs.in("company_id", auth.companies);
      if ((auth.sites || []).length) scopedConfigs = scopedConfigs.in("site_id", auth.sites);
      const [configRows, layerRows] = await Promise.all([
        scopedConfigs,
        admin.from("purchase_requisition_approval_layers").select("*").eq("status", "active"),
      ]);
      if (configRows.error) throw configRows.error; if (layerRows.error) throw layerRows.error;
      const ids = Array.from(new Set((layerRows.data || []).map((x: any) => x.approver_user_id)));
      const profiles = ids.length ? await admin.from("profiles").select("id,full_name,email").in("id", ids) : { data: [], error: null };
      if (profiles.error) throw profiles.error;
      const profileMap = new Map((profiles.data || []).map((x: any) => [x.id, x]));
      const companyMap = new Map((c.data || []).map((x: any) => [x.id, x.company_name]));
      const siteMap = new Map((s.data || []).map((x: any) => [x.id, x.site_name]));
      configurations = (configRows.data || []).map((row: any) => ({ ...row, company_name: companyMap.get(row.company_id) || "-", site_name: siteMap.get(row.site_id) || "-", layers: (layerRows.data || []).filter((layer: any) => layer.configuration_id === row.id && layer.workflow_version === row.workflow_version).sort((a: any, b: any) => a.layer_number - b.layer_number).map((layer: any) => ({ ...layer, approver: profileMap.get(layer.approver_user_id) || null })) }));
    }
    if (companyId && siteId) {
      const valid = await scope(auth, admin, companyId, siteId); if (!valid) return jsonError("Selected company/site is outside your access.", 403);
      const config = await admin.from("purchase_requisition_approval_configurations").select("*").eq("organization_id", valid.organizationId).eq("company_id", companyId).eq("site_id", siteId).maybeSingle(); if (config.error) throw config.error;
      if (config.data) {
        const layers = await admin.from("purchase_requisition_approval_layers").select("*").eq("configuration_id", config.data.id).eq("workflow_version", config.data.workflow_version).eq("status", "active").order("layer_number");
        if (layers.error) throw layers.error;
        configuration = { ...config.data, layers: layers.data || [] };
      }
      const profiles = await admin.from("profiles").select("id,full_name,email,status").eq("status","active").order("full_name"); if (profiles.error) throw profiles.error;
      const access = await admin.from("user_access_assignments").select("user_id,organization_id,company_id,site_id").eq("organization_id", valid.organizationId); if (access.error) throw access.error;
      const allowed = new Set((access.data || []).filter((x: any) => (!x.company_id || x.company_id === companyId) && (!x.site_id || x.site_id === siteId)).map((x: any) => x.user_id));
      for (const layer of configuration?.layers || []) allowed.add(layer.approver_user_id);
      approvers = (profiles.data || []).filter((p: any) => allowed.has(p.id) || auth.isGlobalAccess).map((p: any) => ({ ...p, label: `${p.full_name || p.email} — ${p.email || ""}` }));
    }
    return NextResponse.json({ configuration, configurations, companies: c.data || [], sites: s.data || [], approvers, can_edit: hasServerPermission(auth, MODULE, "edit") });
  } catch (error: any) { return NextResponse.json({ error: error.message || "Failed to load approval configuration." }, { status: 500 }); }
}

export async function PUT(request: Request) {
  try {
    const auth = await requireProcurementPermission(request, MODULE, "edit"); if ("response" in auth) return auth.response;
    const payload = await request.json().catch(() => ({})); const companyId = text(payload.company_id); const siteId = text(payload.site_id); const layerCount = Number(payload.layer_count); if (!companyId || !siteId) return jsonError("Company and site are required.",400); if (![2,3].includes(layerCount)) return jsonError("Approval layers must be 2 or 3.",400);
    const admin = adminClient(); const valid = await scope(auth, admin, companyId, siteId); if (!valid) return jsonError("Selected company/site is outside your access.",403); const incoming = Array.isArray(payload.layers) ? payload.layers : []; if (incoming.length !== layerCount) return jsonError("Every approval layer must be configured.",400);
    const layers = incoming.map((x: any, i: number) => ({ layer_number: i + 1, stage_name: text(x.stage_name) || defaults[i], approver_user_id: text(x.approver_user_id) })).filter((x: any) => x.approver_user_id && x.stage_name); if (layers.length !== layerCount) return jsonError("Each layer requires a stage and approver.",400);
    const profiles = await admin.from("profiles").select("id,full_name,email,status").in("id", layers.map((x: any) => x.approver_user_id)); if (profiles.error) throw profiles.error; if ((profiles.data || []).length !== layerCount || (profiles.data || []).some((p: any) => p.status !== "active")) return jsonError("Every approver must be an active ERP user.",400);
    const actor = { user_id: auth.user.id, name: auth.user.user_metadata?.full_name || auth.user.email, email: auth.user.email };
    const result = await admin.rpc("save_purchase_requisition_approval_configuration_atomic", {
      p_scope: { organization_id: valid.organizationId, company_id: companyId, site_id: siteId },
      p_layers: layers,
      p_actor: actor,
      p_event_note: text(payload.event_note) || null,
    });
    if (result.error) throw result.error;
    return NextResponse.json({ ok: true, ...result.data });
  } catch (error: any) { return NextResponse.json({ error: error.message || "Failed to save approval configuration." }, { status: 500 }); }
}
