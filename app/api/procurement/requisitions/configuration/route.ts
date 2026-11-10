import { NextResponse } from "next/server";
import { adminClient, applyCompanySiteAccess, applyOrganizationAccess, jsonError, requireProcurementPermission, text } from "@/lib/serverProcurementAccess";
import { hasServerPermission } from "@/lib/serverPermissions";

const MODULE = "purchase_requisition_approval_configuration";
const defaults = ["Billing Engineer Verification", "Project Manager Approval", "Final Approval"];
type ScopeInput = { company_id?: unknown; site_id?: unknown };
type ApprovalScope = { companyId: string; siteId: string };
type ValidatedScope = ApprovalScope & { valid: NonNullable<Awaited<ReturnType<typeof scope>>> };

function isScopeInput(value: unknown): value is ScopeInput {
  return typeof value === "object" && value !== null;
}

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
    const allConfigs = applyOrganizationAccess(admin.from("purchase_requisition_approval_configurations").select("id,organization_id,company_id,site_id,layer_count,workflow_version,status,updated_at").eq("status", "active").order("updated_at", { ascending: false }), auth);
    if (allConfigs) {
      let scopedConfigs: any = allConfigs;
      if ((auth.companies || []).length) scopedConfigs = scopedConfigs.in("company_id", auth.companies);
      if ((auth.sites || []).length) scopedConfigs = scopedConfigs.in("site_id", auth.sites);
      const configRows = await scopedConfigs;
      if (configRows.error) throw configRows.error;
      const configurationIds = (configRows.data || []).map((row: any) => row.id);
      const layerRows = configurationIds.length
        ? await admin.from("purchase_requisition_approval_layers").select("configuration_id,workflow_version,layer_number,stage_name,approver_user_id,status").eq("status", "active").in("configuration_id", configurationIds)
        : { data: [], error: null };
      if (layerRows.error) throw layerRows.error;
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
    const payload = await request.json().catch(() => ({}));
    const layerCount = Number(payload.layer_count);
    if (![1, 2, 3].includes(layerCount)) return jsonError("Approval layers must be 1, 2, or 3.", 400);
    const incoming = Array.isArray(payload.layers) ? payload.layers : [];
    if (incoming.length !== layerCount) return jsonError("Every approval layer must be configured.", 400);
    const layers = incoming.map((x: any, i: number) => ({ layer_number: i + 1, stage_name: text(x.stage_name) || defaults[i], approver_user_id: text(x.approver_user_id) })).filter((x: any) => x.approver_user_id && x.stage_name);
    if (layers.length !== layerCount) return jsonError("Each layer requires a stage and approver.", 400);
    const requestedScopes = Array.isArray(payload.scopes) ? payload.scopes : [{ company_id: payload.company_id, site_id: payload.site_id }];
    const requestedScopeValues: unknown[] = requestedScopes;
    if (!requestedScopeValues.every(isScopeInput)) return jsonError("Each company/site scope must be an object.", 400);
    const scopes: ApprovalScope[] = Array.from(new Map(requestedScopeValues.map((x) => [`${text(x.company_id)}:${text(x.site_id)}`, { companyId: text(x.company_id), siteId: text(x.site_id) }])).values()).filter((x): x is ApprovalScope => Boolean(x.companyId && x.siteId));
    if (!scopes.length) return jsonError("At least one company/site scope is required.", 400);
    const admin = adminClient();
    const validated: ValidatedScope[] = [];
    for (const selected of scopes) {
      const valid = await scope(auth, admin, selected.companyId, selected.siteId);
      if (!valid) return jsonError("One or more selected company/site scopes are outside your access.", 403);
      validated.push({ ...selected, valid });
    }
    const approverIds = Array.from(new Set(layers.map((layer: any) => layer.approver_user_id)));
    const profiles = await admin.from("profiles").select("id,full_name,email,status").in("id", approverIds); if (profiles.error) throw profiles.error;
    const assignments = await admin.from("user_access_assignments").select("user_id,organization_id,company_id,site_id"); if (assignments.error) throw assignments.error;
    const profileMap = new Map((profiles.data || []).map((p: any) => [p.id, p]));
    const bypassScope = auth.isGlobalAccess || (auth.roleCodes || []).includes("platform_owner");
    for (const selected of validated) {
      const eligible = layers.every((layer: any) => { const profile = profileMap.get(layer.approver_user_id); if (!profile || profile.status !== "active") return false; if (bypassScope) return true; return (assignments.data || []).some((entry: any) => entry.user_id === profile.id && entry.organization_id === selected.valid.organizationId && (!entry.company_id || entry.company_id === selected.companyId) && (!entry.site_id || entry.site_id === selected.siteId)); });
      if (!eligible) return jsonError("Every approver must be an active ERP user with access to each selected company and site.", 400);
    }
    const existing = await admin.from("purchase_requisition_approval_configurations").select("company_id,site_id").eq("status", "active").in("company_id", validated.map((x: any) => x.companyId)).in("site_id", validated.map((x: any) => x.siteId));
    if (existing.error) throw existing.error;
    const existingKeys = new Set((existing.data || []).map((x: any) => `${x.company_id}:${x.site_id}`));
    const replacements = validated.filter((x: any) => existingKeys.has(`${x.companyId}:${x.siteId}`));
    if (replacements.length && payload.confirm_overwrite !== true) return NextResponse.json({ error: "Some selected scopes already have an active policy.", requires_overwrite_confirmation: true, existing_scopes: replacements.map((x: any) => ({ company_id: x.companyId, site_id: x.siteId })) }, { status: 409 });
    const actor = { user_id: auth.user.id, name: auth.user.user_metadata?.full_name || auth.user.email, email: auth.user.email };
    const results = [];
    for (const selected of validated) {
      const result = await admin.rpc("save_purchase_requisition_approval_configuration_atomic", { p_scope: { organization_id: selected.valid.organizationId, company_id: selected.companyId, site_id: selected.siteId }, p_layers: layers, p_actor: actor, p_event_note: text(payload.event_note) || null });
      if (result.error) throw result.error;
      results.push({ company_id: selected.companyId, site_id: selected.siteId, ...result.data });
    }
    return NextResponse.json({ ok: true, scopes: results, ...results[0] });
  } catch (error: any) { return NextResponse.json({ error: error.message || "Failed to save approval configuration." }, { status: 500 }); }
}
