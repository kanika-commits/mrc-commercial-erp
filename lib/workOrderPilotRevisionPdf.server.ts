import { loadWorkOrderLetterheadAssets, renderWorkOrderPdf, structuredTermsFromSnapshot } from "@/lib/workOrderPdfRenderer.server";
import { PILOT_REVISION_NOTICE, redlineValue } from "@/lib/workOrderPilotRevisions.server";

export async function renderPilotRevisionPdf(snapshot: any, predecessor: any, displayContext: any = {}) {
  predecessor = predecessor || displayContext.canonicalBaseline || null;
  const current = { ...(snapshot.snapshot?.fields || {}), ...(snapshot.snapshot?.totals || {}) };
  const items = (snapshot.snapshot?.items || []).map((item: any, index: number) => normalizeItem(item, index));
  const canonicalDelivery = displayContext.delivery_snapshot || {};
  const revisionDelivery = current.delivery_snapshot || {};
  const row = {
    ...current,
    wo_date: snapshot.applicable_date || current.wo_date,
    original_wo_date: displayContext.original_wo_date || current.original_wo_date,
    created_by: displayContext.created_by || current.created_by,
    created_by_name: displayContext.created_by_name || current.created_by_name,
    created_by_email: displayContext.created_by_email || current.created_by_email,
    created_at: displayContext.created_at || snapshot.created_at,
    company: { company_name: displayContext.company_name || current.company_name || "-" },
    site: { site_name: displayContext.site_name || current.site_name || "-" },
    vendor_snapshot: current.vendor_snapshot || displayContext.vendor_snapshot || {},
    delivery_snapshot: {
      ...canonicalDelivery,
      ...revisionDelivery,
      gst_billing: canonicalDelivery.gst_billing || revisionDelivery.gst_billing,
      billing_address: canonicalDelivery.billing_address || revisionDelivery.billing_address,
      delivery_location: canonicalDelivery.delivery_location || revisionDelivery.delivery_location,
      billing_contact: canonicalDelivery.billing_contact || revisionDelivery.billing_contact,
      delivery_contact: canonicalDelivery.delivery_contact || revisionDelivery.delivery_contact,
    },
    billing_snapshot: current.billing_snapshot || displayContext.billing_snapshot || {},
    items,
    standard_terms_clauses: current.standard_terms_clauses || current.standard_terms_snapshot,
    work_order_key_terms: current.work_order_key_terms || {},
    approval_status: "draft",
  };
  const assets = await loadWorkOrderLetterheadAssets(current.letterhead_snapshot || displayContext.letterhead_snapshot, displayContext.letterhead_id, current.company_id);
  const previous = { ...(predecessor?.snapshot?.fields || {}), ...(predecessor?.snapshot?.totals || {}) };
  const diff = (oldValue: unknown, newValue: unknown) => redlineValue(oldValue, newValue);
  const textDiff = (oldValue: unknown, newValue: unknown) => {
    const before = String(oldValue ?? "");
    const after = String(newValue ?? "");
    if (before === after) return { kind: "unchanged", value: newValue };
    if (!before) return { kind: "added", value: newValue };
    if (!after) return { kind: "deleted", value: before, runs: [{ text: before, color: "black", strike: true }] };
    let prefix = 0;
    while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1;
    let suffix = 0;
    while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - suffix - 1] === after[after.length - suffix - 1]) suffix += 1;
    const runs: Array<{ text: string; color: "black" | "red"; strike?: boolean }> = [];
    if (prefix) runs.push({ text: after.slice(0, prefix), color: "black" });
    if (before.slice(prefix, before.length - suffix)) runs.push({ text: before.slice(prefix, before.length - suffix), color: "black", strike: true });
    if (after.slice(prefix, after.length - suffix)) runs.push({ text: after.slice(prefix, after.length - suffix), color: "red" });
    if (suffix) runs.push({ text: after.slice(after.length - suffix), color: "black" });
    return { kind: "changed", value: newValue, previous: oldValue, runs };
  };
  const locked = new Set(["company_id", "site_id", "vendor_id", "wo_number"]);
  const fields: Record<string, any> = {};
  for (const key of ["wo_date", "wo_type", "description", "wo_value", "gst_percent", "total_basic_amount", "total_gst_amount", "total_amount"]) fields[key] = diff(normalizeComparable(previous[key], key), normalizeComparable(current[key], key));
  fields.wo_date = diff(previous.wo_date, snapshot.applicable_date);
  for (const key of locked) fields[key] = { kind: "unchanged", value: current[key] };
  const previousItems = Array.isArray(predecessor?.snapshot?.items) ? predecessor.snapshot.items.map((item: any, index: number) => normalizeItem(item, index)) : [];
  if (previousItems.length && previous.total_basic_amount == null) {
    previous.total_basic_amount = previousItems.reduce((sum: number, item: any) => sum + Number(item.basic_amount || 0), 0);
    previous.total_gst_amount = previousItems.reduce((sum: number, item: any) => sum + Number(item.gst_amount || 0), 0);
    previous.total_amount = previousItems.reduce((sum: number, item: any) => sum + Number(item.total_amount ?? item.line_total ?? 0), 0);
  }
  const calculatedTotals = (rows: any[]) => rows.reduce((totals, item) => {
    const basic = Number(item.quantity || 0) * Number(item.unit_rate || 0);
    const gst = basic * Number(item.gst_rate ?? item.gst_percent ?? 0) / 100;
    return { basic: totals.basic + basic, gst: totals.gst + gst, total: totals.total + basic + gst };
  }, { basic: 0, gst: 0, total: 0 });
  const oldCalculated = calculatedTotals(previousItems);
  const currentCalculated = calculatedTotals(items);
  row.total_basic_amount = Number(currentCalculated.basic.toFixed(2));
  row.total_gst_amount = Number(currentCalculated.gst.toFixed(2));
  row.total_amount = Number(currentCalculated.total.toFixed(2));
  fields.total_basic_amount = diff(oldCalculated.basic, currentCalculated.basic);
  fields.total_gst_amount = diff(oldCalculated.gst, currentCalculated.gst);
  fields.total_amount = diff(oldCalculated.total, currentCalculated.total);
  const unusedPrevious = [...previousItems];
  const itemRedlines = items.map((item: any) => {
    const key = itemIdentity(item);
    const oldIndex = unusedPrevious.findIndex((candidate) => itemMatches(candidate, item));
    const old = oldIndex >= 0 ? unusedPrevious.splice(oldIndex, 1)[0] : undefined;
    const fields: Record<string, any> = {}; for (const field of ITEM_DIFF_FIELDS) fields[field] = diff(normalizeComparable(old?.[field], field), normalizeComparable(item?.[field], field));
    return { identity: diff(old ? key : undefined, key), current: item, previous: old, fields };
  });
  for (const old of unusedPrevious) {
    const fields: Record<string, any> = {};
    for (const field of ITEM_DIFF_FIELDS) fields[field] = diff(normalizeComparable(old?.[field], field), undefined);
    itemRedlines.push({ identity: diff(itemIdentity(old), undefined), current: null, previous: old, fields });
  }
  const currentTerms = normalizeRevisionTerms(current.standard_terms_clauses || current.standard_terms_snapshot);
  const previousTerms = normalizeRevisionTerms(previous.standard_terms_clauses || previous.standard_terms_snapshot);
  const unusedPreviousTerms = [...previousTerms];
  const terms = currentTerms.map((term: any) => {
    const oldIndex = findMatchingTerm(unusedPreviousTerms, term);
    const old = oldIndex >= 0 ? unusedPreviousTerms.splice(oldIndex, 1)[0] : undefined;
    return { identity: term.identity, heading: textDiff(old?.heading, term.heading), body: textDiff(old?.body, term.body), current: term, previous: old };
  });
  for (const term of unusedPreviousTerms) terms.push({ identity: term.identity, heading: textDiff(term.heading, undefined), body: textDiff(term.body, undefined), current: null, previous: term });
  const displayTerms = [...currentTerms, ...unusedPreviousTerms].sort((a, b) => a.sort_order - b.sort_order).map((term) => ({ ...term, id: term.identity, heading: term.heading, clause_body: term.body }));
  row.standard_terms_clauses = displayTerms;
  const currentKeyTerms = normalizeKeyTermsForRevision(current.work_order_key_terms || current.key_terms || current.key_terms_snapshot);
  const previousKeyTerms = normalizeKeyTermsForRevision(previous.work_order_key_terms || previous.key_terms || previous.key_terms_snapshot);
  const keyTermQueues = new Map<string, any[]>();
  for (const term of previousKeyTerms) keyTermQueues.set(term.label.toLowerCase(), [...(keyTermQueues.get(term.label.toLowerCase()) || []), term]);
  const keyTerms: any[] = currentKeyTerms.map((term: any) => {
    const old = (keyTermQueues.get(term.label.toLowerCase()) || []).shift();
    return { identity: term.label, label: diff(old?.label, term.label), value: textDiff(old?.value, term.value) };
  });
  for (const list of keyTermQueues.values()) for (const term of list) keyTerms.push({ identity: term.label, label: diff(term.label, undefined), value: textDiff(term.value, undefined) });
  const totals = Object.fromEntries(["total_basic_amount", "total_gst_amount", "total_amount"].map((key) => [key, fields[key]]));
  return renderWorkOrderPdf(row, assets, { revisionNumber: snapshot.revision_number, applicableDate: snapshot.applicable_date, notice: PILOT_REVISION_NOTICE, redlines: { fields, items: itemRedlines, totals, keyTerms, terms } });
}

function normalizeRevisionTerms(input: any) {
  return (structuredTermsFromSnapshot(input) || []).map((term: any, index: number) => ({
    identity: String(term?.id || term?.clause_id || term?.standard_term_id || "").trim() || `heading:${normalizeTermText(term?.heading ?? term?.title ?? term?.name ?? term?.clause_heading ?? term?.section_heading ?? term?.heading_text)}`,
    heading: String(term?.heading ?? term?.title ?? term?.name ?? term?.clause_heading ?? term?.section_heading ?? term?.heading_text ?? "").trim(),
    body: String(term?.clause_body ?? term?.body_text ?? term?.bodyText ?? (typeof term?.body === "string" ? term.body : term?.body?.text ?? term?.body?.content) ?? term?.text ?? term?.content ?? term?.description ?? term?.terms ?? "").trim(),
    sort_order: Number.isFinite(Number(term?.sort_order)) ? Number(term.sort_order) : index,
  }));
}

function normalizeTermText(input: any) {
  return String(input ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function findMatchingTerm(previous: any[], current: any) {
  const id = current.identity.startsWith("heading:") ? "" : current.identity;
  if (id) {
    const matches = previous.filter((term) => term.identity === id);
    if (matches.length === 1) return previous.indexOf(matches[0]);
  }
  const heading = normalizeTermText(current.heading);
  if (heading) {
    const matches = previous.filter((term) => normalizeTermText(term.heading) === heading);
    if (matches.length === 1) return previous.indexOf(matches[0]);
  }
  const body = normalizeTermText(current.body);
  if (body) {
    const matches = previous.filter((term) => normalizeTermText(term.body) === body);
    if (matches.length === 1) return previous.indexOf(matches[0]);
  }
  return -1;
}

const ITEM_DIFF_FIELDS = ["item_header_snapshot", "description_snapshot", "additional_description_snapshot", "make_snapshot", "unit_snapshot", "quantity", "unit_rate", "gst_percent", "gst_rate", "basic_amount", "gst_amount", "line_total", "total_amount"];

function normalizeItem(item: any, index: number) {
  const quantity = item.quantity ?? item.qty;
  const unitRate = item.unit_rate ?? item.rate;
  const gstPercent = item.gst_percent ?? item.gst_rate;
  const basicAmount = item.basic_amount ?? item.basic_amount_snapshot ?? (Number(quantity || 0) * Number(unitRate || 0));
  const gstAmount = item.gst_amount ?? item.gst_amount_snapshot ?? (basicAmount * Number(gstPercent || 0) / 100);
  return {
    ...item,
    item_master_id: item.item_master_id || item.item_id || null,
    item_name_snapshot: item.item_name_snapshot || item.item_header_snapshot || item.item_header || item.name || "",
    item_header_snapshot: item.item_header_snapshot || item.item_name_snapshot || item.item_header || item.name || "",
    specification_snapshot: item.specification_snapshot || item.description_snapshot || item.description || "",
    description_snapshot: item.description_snapshot || item.specification_snapshot || item.description || "",
    additional_description_snapshot: item.additional_description_snapshot || item.additional_description || "",
    make_snapshot: item.make_snapshot || item.mode_of_measurement_snapshot || item.mode_of_measurement || "",
    quantity,
    unit_rate: unitRate,
    gst_percent: gstPercent,
    gst_rate: item.gst_rate ?? gstPercent,
    basic_amount: basicAmount,
    gst_amount: gstAmount,
    line_total: item.line_total ?? item.total_amount ?? (basicAmount + gstAmount),
    total_amount: item.total_amount ?? item.line_total ?? (basicAmount + gstAmount),
    serial_no: index + 1,
  };
}

function normalizeComparable(input: unknown, field: string) {
  if (input === null || input === undefined || input === "") return input;
  if (["quantity", "unit_rate", "gst_percent", "gst_rate", "basic_amount", "gst_amount", "line_total", "total_amount"].includes(field)) {
    const number = Number(input);
    return Number.isFinite(number) ? number : input;
  }
  return String(input).trim();
}

function itemIdentity(item: any) {
  return String(item?.item_master_id || item?.item_header_snapshot || item?.item_name_snapshot || item?.description_snapshot || "").trim().toLowerCase();
}

function itemMatches(previous: any, current: any) {
  if (previous?.item_master_id && current?.item_master_id) return String(previous.item_master_id) === String(current.item_master_id);
  return itemIdentity(previous) === itemIdentity(current) && normalizeComparable(previous?.description_snapshot, "description_snapshot") === normalizeComparable(current?.description_snapshot, "description_snapshot");
}

function normalizeKeyTermsForRevision(input: any) {
  const rows: Array<{ label: string; value: string }> = [];
  if (Array.isArray(input)) return input.map((entry: any) => ({ label: String(entry?.label || entry?.heading || entry?.description || "Additional Term"), value: String(entry?.value || entry?.terms || entry?.body || "") }));
  const text = (entry: any) => typeof entry === "object" && entry !== null ? String(entry.value || entry.terms || entry.body || entry.description || "") : String(entry ?? "");
  for (const entry of Array.isArray(input?.inclusions) ? input.inclusions : []) rows.push({ label: "Inclusions", value: text(entry) });
  for (const entry of Array.isArray(input?.exclusions) ? input.exclusions : []) rows.push({ label: "Exclusions", value: text(entry) });
  for (const entry of Array.isArray(input?.additional) ? input.additional : []) rows.push({ label: String(entry?.label || entry?.description || "Additional Term"), value: String(entry?.value || entry?.terms || "") });
  return rows;
}
