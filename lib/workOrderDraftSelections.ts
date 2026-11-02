export type WorkOrderDraftSelections = {
  gst_registration_id: string;
  billing_address_id: string;
  delivery_location_id: string;
  billing_contact_id: string;
  delivery_contact_id: string;
  letterhead_id: string;
  terms_template_id: string;
};

function retainSelectedLookupOption(options: any[], id: string, labelKey: string, label: string) {
  if (!id || options.some((option) => option.id === id) || !label) return options;
  return [{ id, [labelKey]: label }, ...options];
}
function retainSavedSnapshot(options: any[], snapshot: any, fallback: Record<string, unknown> = {}) {
  const id = snapshot?.id || fallback.id;
  if (!id || options.some((option) => option.id === id)) return options;
  const saved = { ...fallback, ...(snapshot || {}) };
  // Older drafts contain partial snapshots. Keep the authorized lookup scope
  // from the saved selection when the snapshot does not repeat it; otherwise
  // the form's derived filters discard the retained option immediately.
  for (const key of ["company_id", "site_id", "gst_registration_id"] as const) {
    if (fallback[key]) saved[key] = fallback[key];
  }
  if (!saved.status && fallback.status) saved.status = fallback.status;
  if (fallback.billing_address && (!saved.billing_address || !saved.billing_address.gst_registration_id)) {
    saved.billing_address = { ...fallback.billing_address, ...(saved.billing_address || {}) };
  }
  const label = saved.label || saved.location_name || saved.letterhead_name || saved.template_name || saved.contact_name || saved.gstin || saved.trade_name || saved.legal_name || saved.vendor_name || saved.company_name || saved.site_name || saved.address_line1 || saved.state;
  return label ? [saved, ...options] : options;
}

export function mergeWorkOrderDraftLookupOptions(lookups: any, draft: any) {
  const snapshot = draft?.delivery_snapshot || {};
  const vendorSnapshot = snapshot.vendor_snapshot || draft?.vendor_snapshot || {};
  const selection = snapshot.master_selection || draft?.master_selection || {};
  const contacts = snapshot.contact_selection || draft?.contact_selection || {};
  // The draft GET response also exposes normalized top-level selection IDs.
  // Prefer those when older/partial snapshots do not contain master_selection;
  // this preserves the selected value while the authorized lookup options load.
  const saved = readWorkOrderDraftSelections(draft);
  const companyScope = { company_id: draft?.company_id, status: "active" };
  const siteScope = { site_id: draft?.site_id, status: "active" };
  return {
    ...lookups,
    companies: retainSelectedLookupOption(lookups.companies || [], draft?.company_id || "", "company_name", draft?.company_name || draft?.company?.company_name || ""),
    sites: retainSelectedLookupOption(lookups.sites || [], draft?.site_id || "", "site_name", draft?.site_name || draft?.site?.site_name || ""),
    vendors: retainSelectedLookupOption(lookups.vendors || [], draft?.vendor_id || vendorSnapshot.vendor_id || "", "vendor_name", draft?.vendor_name_snapshot || vendorSnapshot.vendor_name || ""),
    gst_billing_masters: retainSavedSnapshot(lookups.gst_billing_masters || [], snapshot.gst_billing || snapshot.gst_snapshot || draft?.gst_snapshot, { id: saved.gst_registration_id || selection.gst_registration_id, ...companyScope }),
    billing_addresses: retainSavedSnapshot(lookups.billing_addresses || [], snapshot.billing_address || snapshot.billing_snapshot || draft?.billing_snapshot, { id: saved.billing_address_id || selection.billing_address_id, ...companyScope, gst_registration_id: saved.gst_registration_id || selection.gst_registration_id }),
    // Draft PATCH stores the selected delivery row itself at
    // delivery_snapshot, while create stores it under delivery_location.
    delivery_locations: retainSavedSnapshot(lookups.delivery_locations || [], snapshot.delivery_location || (snapshot.id ? snapshot : null), { id: saved.delivery_location_id || selection.delivery_location_id, ...siteScope, billing_address: { gst_registration_id: saved.gst_registration_id || selection.gst_registration_id } }),
    site_contacts: [snapshot.billing_contact, snapshot.delivery_contact, draft?.billing_contact_snapshot, draft?.delivery_contact_snapshot]
      .filter(Boolean)
      .reduce((options, saved) => retainSavedSnapshot(options, saved, { site_id: draft?.site_id, status: "active" }), lookups.site_contacts || []),
    letterheads: retainSavedSnapshot(lookups.letterheads || [], draft?.letterhead_snapshot, { company_id: draft?.company_id, status: "active" }),
    terms_templates: retainSavedSnapshot(lookups.terms_templates || [], draft?.terms_template_snapshot, { company_id: draft?.company_id, status: "active" }),
  };
}


const text = (value: unknown) => String(value ?? "");

export function readWorkOrderDraftSelections(draft: any): WorkOrderDraftSelections {
  const snapshot = draft?.delivery_snapshot || {};
  const selection = snapshot.master_selection || draft?.master_selection || {};
  const contacts = snapshot.contact_selection || draft?.contact_selection || {};
  return {
    gst_registration_id: text(draft?.gst_registration_id || selection.gst_registration_id || snapshot.gst_registration_id || snapshot.gst_billing?.id || snapshot.gst_snapshot?.id || draft?.gst_snapshot?.id),
    billing_address_id: text(draft?.billing_address_id || selection.billing_address_id || snapshot.billing_address_id || snapshot.billing_address?.id || snapshot.billing_snapshot?.id || draft?.billing_snapshot?.id),
    delivery_location_id: text(draft?.delivery_location_id || selection.delivery_location_id || snapshot.delivery_location?.id || snapshot.id),
    billing_contact_id: text(draft?.billing_contact_id || contacts.billing_contact_id || selection.billing_contact_id || snapshot.billing_contact_id || snapshot.billing_contact?.id || snapshot.billing_contact_snapshot?.id || draft?.billing_contact_snapshot?.id),
    delivery_contact_id: text(draft?.delivery_contact_id || contacts.delivery_contact_id || selection.delivery_contact_id || snapshot.delivery_contact_id || snapshot.delivery_contact?.id || snapshot.delivery_contact_snapshot?.id || draft?.delivery_contact_snapshot?.id),
    letterhead_id: text(draft?.letterhead_id || selection.letterhead_id || snapshot.letterhead_id || draft?.letterhead_snapshot?.id),
    terms_template_id: text(draft?.terms_template_id || selection.terms_template_id || snapshot.terms_template_id || draft?.terms_template_snapshot?.id),
  };
}


function normalizedTermsSnapshot(value: unknown): string {
  if (!value) return "";
  let parsed: any = value;
  if (typeof parsed === "string") {
    try { parsed = JSON.parse(parsed); } catch { return parsed.replace(/\s+/g, " ").trim(); }
  }
  const sections = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.sections) ? parsed.sections : null;
  if (!sections) return String(value).replace(/\s+/g, " ").trim();
  return [...sections]
    .filter((section: any) => section?.status !== "inactive")
    .sort((a: any, b: any) => Number(a?.sort_order || 0) - Number(b?.sort_order || 0))
    .map((section: any) => `${String(section?.heading || "").trim()}\n${String(section?.clause_body || "").trim()}`.replace(/\bWork Order\b/gi, "Purchase Order").replace(/\bWO\b/g, "PO").replace(/\s+/g, " ").trim())
    .join(" ");
}

export type WorkOrderSavedTerm = { heading: string; clause_body: string };

export function readSavedTermsClauses(value: unknown): WorkOrderSavedTerm[] {
  if (!value) return [];
  let parsed: any = value;
  if (typeof parsed === "string") {
    try { parsed = JSON.parse(parsed); } catch { return [{ heading: "", clause_body: parsed }]; }
  }
  const sections = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.sections) ? parsed.sections : null;
  if (!sections) return [{ heading: "", clause_body: String(value) }];
  const clauses = [...sections]
    .filter((section: any) => section?.status !== "inactive")
    .sort((a: any, b: any) => Number(a?.sort_order || 0) - Number(b?.sort_order || 0))
    .map((section: any) => ({
      heading: String(section?.heading || "Saved Terms & Conditions").trim(),
      clause_body: String(section?.clause_body || "").trim(),
    }))
    .filter((section) => section.heading || section.clause_body);
  const metadata = /^saved terms(?: &| and) conditions$/i;
  if (clauses.length === 1 && metadata.test(clauses[0].heading)) {
    const rawBody = clauses[0].clause_body.replace(/^saved terms(?: &| and) conditions\s*/i, "").trim();
    const blocks = rawBody.split(/\r?\n\s*\r?\n/).map((block) => block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)).filter((block) => block.length > 1);
    if (blocks.length > 1) return blocks.map((block) => ({ heading: block[0], clause_body: block.slice(1).join("\n") }));
  }
  if (clauses.length === 1 && clauses[0].clause_body.includes("\n")) {
    const blocks = clauses[0].clause_body.split(/\r?\n\s*\r?\n/).map((block) => block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)).filter((block) => block.length > 1);
    if (blocks.length > 1) return blocks.map((block) => ({ heading: block[0], clause_body: block.slice(1).join("\n") }));
  }
  const withoutWrapper = clauses.filter((section) => !metadata.test(section.heading));
  if (withoutWrapper.length) {
    const first = withoutWrapper[0];
    const bodyLines = first.clause_body.split(/\r?\n/);
    if (metadata.test(bodyLines[0]?.trim() || "")) first.clause_body = bodyLines.slice(1).join("\n").trim();
  }
  return withoutWrapper;
}

export function matchSavedTermsTemplateId(savedSnapshot: unknown, templates: any[]): string {
  let parsed: any = savedSnapshot;
  if (typeof parsed === "string") {
    try { parsed = JSON.parse(parsed); } catch { parsed = null; }
  }
  const savedId = text(parsed?.terms_template_id || parsed?.template_id || parsed?.termsTemplateId || parsed?.id);
  if (savedId) {
    const byId = templates.find((template: any) => text(template?.id) === savedId);
    if (byId) return text(byId.id);
  }
  const savedName = text(parsed?.template_name || parsed?.terms_template_name || parsed?.name).toLowerCase();
  if (savedName) {
    const byName = templates.find((template: any) => text(template?.template_name || template?.name).toLowerCase() === savedName);
    if (byName) return text(byName.id);
  }
  const saved = normalizedTermsSnapshot(savedSnapshot);
  if (!saved) return "";
  const match = templates.find((template: any) => normalizedTermsSnapshot(template?.sections) === saved);
  return text(match?.id);
}
