export type RevisionState = "unchanged" | "added" | "removed" | "changed";
export type RevisionField<T> =
  | { state: "unchanged"; value: T }
  | { state: "added"; after: T }
  | { state: "removed"; before: T }
  | { state: "changed"; before: T; after: T };

export type RevisionItemComparison = {
  revision_line_key: string;
  state: RevisionState;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  fields: Record<string, RevisionField<unknown>>;
};

const ITEM_FIELDS = ["item_name_snapshot", "item_code_snapshot", "specification_snapshot", "make_snapshot", "quantity", "uom_snapshot", "unit_rate", "discount_percent", "discount_amount", "taxable_amount", "gst_rate", "gst_amount", "total_amount", "remarks_snapshot"];

export function normalizeRevisionText(value: unknown): string {
  return String(value ?? "").replace(/\r\n/g, "\n").split("\n").map((line) => line.trim()).filter(Boolean).join("\n").trim();
}

export function diffRevisionValue<T>(before: T | null | undefined, after: T | null | undefined): RevisionField<T> {
  const beforePresent = before !== null && before !== undefined && String(before) !== "";
  const afterPresent = after !== null && after !== undefined && String(after) !== "";
  const equal = typeof before === "string" || typeof after === "string"
    ? normalizeRevisionText(before) === normalizeRevisionText(after)
    : Object.is(before, after) || JSON.stringify(before) === JSON.stringify(after);
  if (!beforePresent && !afterPresent) return { state: "unchanged", value: after as T };
  if (!beforePresent) return { state: "added", after: after as T };
  if (!afterPresent) return { state: "removed", before: before as T };
  return equal ? { state: "unchanged", value: after as T } : { state: "changed", before: before as T, after: after as T };
}

function identity(value: any): string {
  return String(value?.id ?? value?.code ?? value?.key ?? value?.description ?? value?.label ?? "");
}

export function visibleRevisionClause(clause: any) {
  return { id: clause?.id ?? clause?.key ?? clause?.code ?? clause?.heading ?? clause?.title ?? clause?.label, heading: normalizeRevisionText(clause?.heading), clause_body: normalizeRevisionText(clause?.clause_body) };
}

export function buildPurchaseOrderRevisionComparison(previous: any, current: any) {
  const previousItems = Array.isArray(previous?.items) ? previous.items : [];
  const currentItems = Array.isArray(current?.items) ? current.items : [];
  const legacySingleLineKey = previousItems.length === 1 && currentItems.length === 1 && !previousItems[0]?.revision_line_key && !currentItems[0]?.revision_line_key
    ? "__legacy_single_line__"
    : null;
  const stableItemIdentity = (item: any) => item?.revision_line_key || item?.source_requisition_line_key || item?.item_id_snapshot || null;
  const beforeMatched = new Set<number>();
  const currentMatched = new Set<number>();
  const pairs: Array<{ before: any | null; after: any | null; key: string }> = [];
  const beforeByIdentity = new Map<string, number[]>();
  const currentIdentityOccurrences = new Map<string, number>();
  previousItems.forEach((item: any, index: number) => {
    const key = stableItemIdentity(item);
    if (!key) return;
    const normalizedKey = String(key);
    const entries = beforeByIdentity.get(normalizedKey) || [];
    entries.push(index);
    beforeByIdentity.set(normalizedKey, entries);
  });
  currentItems.forEach((item: any, currentIndex: number) => {
    const key = stableItemIdentity(item);
    const normalizedKey = key ? String(key) : null;
    const queue = normalizedKey ? beforeByIdentity.get(normalizedKey) : undefined;
    const beforeIndex = queue?.find((index) => !beforeMatched.has(index));
    if (beforeIndex === undefined) return;
    const occurrence = currentIdentityOccurrences.get(normalizedKey!) || 0;
    currentIdentityOccurrences.set(normalizedKey!, occurrence + 1);
    beforeMatched.add(beforeIndex); currentMatched.add(currentIndex);
    pairs.push({ before: previousItems[beforeIndex], after: item, key: occurrence === 0 ? normalizedKey! : `${normalizedKey}#${occurrence}` });
  });
  const unmatchedBefore = previousItems.map((item: any, index: number) => ({ item, index })).filter(({ index }) => !beforeMatched.has(index));
  const unmatchedCurrent = currentItems.map((item: any, index: number) => ({ item, index })).filter(({ index }) => !currentMatched.has(index));
  const hasAnyStableIdentity = previousItems.some((item: any) => stableItemIdentity(item)) || currentItems.some((item: any) => stableItemIdentity(item));
  const fallbackCount = hasAnyStableIdentity ? 0 : Math.min(unmatchedBefore.length, unmatchedCurrent.length);
  for (let index = 0; index < fallbackCount; index += 1) {
    const before = unmatchedBefore[index]; const after = unmatchedCurrent[index];
    pairs.push({ before: before.item, after: after.item, key: legacySingleLineKey || `__position_${after.index}` });
  }
  unmatchedBefore.slice(fallbackCount).forEach(({ item, index }) => {
    const rawKey = stableItemIdentity(item);
    if (!rawKey) { pairs.push({ before: item, after: null, key: `__position_${index}` }); return; }
    const normalizedKey = String(rawKey);
    const occurrence = previousItems.slice(0, index).filter((candidate: any) => String(stableItemIdentity(candidate) || "") === normalizedKey).length;
    pairs.push({ before: item, after: null, key: occurrence === 0 ? normalizedKey : `${normalizedKey}#${occurrence}` });
  });
  unmatchedCurrent.slice(fallbackCount).forEach(({ item, index }) => {
    const rawKey = stableItemIdentity(item);
    if (!rawKey) { pairs.push({ before: null, after: item, key: `__position_${index}` }); return; }
    const normalizedKey = String(rawKey);
    const occurrence = currentIdentityOccurrences.get(normalizedKey) || 0;
    currentIdentityOccurrences.set(normalizedKey, occurrence + 1);
    pairs.push({ before: null, after: item, key: occurrence === 0 ? normalizedKey : `${normalizedKey}#${occurrence}` });
  });
  const items: RevisionItemComparison[] = [];
  for (const { before: beforeValue, after: afterValue, key } of pairs) {
    const before = beforeValue || null;
    const after = afterValue || null;
    const fields = Object.fromEntries([
      ...ITEM_FIELDS.map((field) => [field, diffRevisionValue(before?.[field], after?.[field])]),
      ["basic_amount", diffRevisionValue(
        before ? Number(before.quantity || 0) * Number(before.unit_rate || 0) : undefined,
        after ? Number(after.quantity || 0) * Number(after.unit_rate || 0) : undefined,
      )],
    ]);
    const state = before && after ? (Object.values(fields).some((field: any) => field.state !== "unchanged") ? "changed" : "unchanged") : before ? "removed" : "added";
    items.push({ revision_line_key: key, state: state as RevisionState, before: before as Record<string, unknown> | null, after: after as Record<string, unknown> | null, fields });
  }
  const beforeTerms = Array.isArray(previous?.commercial_snapshot?.key_terms) ? previous.commercial_snapshot.key_terms : [];
  const afterTerms = Array.isArray(current?.commercial_snapshot?.key_terms) ? current.commercial_snapshot.key_terms : [];
  const keyTerms = new Map([...beforeTerms, ...afterTerms].map((term: any) => [identity(term), term]));
  const termComparisons = [...keyTerms.keys()].map((key) => {
    const before = beforeTerms.find((term: any) => identity(term) === key);
    const after = afterTerms.find((term: any) => identity(term) === key);
    return { identity: key, state: diffRevisionValue(before?.value ?? before?.terms ?? before?.text, after?.value ?? after?.terms ?? after?.text).state, before: before?.value ?? before?.terms ?? before?.text, after: after?.value ?? after?.terms ?? after?.text };
  });
  const beforeCharges = Array.isArray(previous?.commercial_snapshot?.additional_charges) ? previous.commercial_snapshot.additional_charges : [];
  const afterCharges = Array.isArray(current?.commercial_snapshot?.additional_charges) ? current.commercial_snapshot.additional_charges : [];
  const chargeComparisons = [...new Set([...beforeCharges, ...afterCharges].map(identity))].map((key) => {
    const before = beforeCharges.find((charge: any) => identity(charge) === key);
    const after = afterCharges.find((charge: any) => identity(charge) === key);
    return { identity: key, state: before && after ? diffRevisionValue(before.amount, after.amount).state : before ? "removed" : "added", before, after };
  });
  const parseClauses = (snapshot: any) => {
    try { const parsed = typeof snapshot === "string" ? JSON.parse(snapshot) : snapshot; return Array.isArray(parsed?.clauses) ? parsed.clauses : []; } catch { return []; }
  };
  const beforeClauses = parseClauses(previous?.standard_terms_snapshot);
  const afterClauses = parseClauses(current?.standard_terms_snapshot);
  const clauseKeys = new Set([...beforeClauses, ...afterClauses].map((clause: any) => String(clause?.id ?? clause?.key ?? clause?.code ?? "")));
  const standardTerms = [...clauseKeys].map((key) => {
    const before = beforeClauses.find((clause: any) => String(clause?.id ?? clause?.key ?? clause?.code ?? "") === key);
    const after = afterClauses.find((clause: any) => String(clause?.id ?? clause?.key ?? clause?.code ?? "") === key);
    const heading = diffRevisionValue(before?.heading, after?.heading);
    const body = diffRevisionValue(before?.clause_body, after?.clause_body);
    return { identity: key, state: heading.state === "unchanged" && body.state === "unchanged" ? "unchanged" : before && after ? "changed" : before ? "removed" : "added", before, after };
  });
  const rendererSnapshot = {
    previous_revision_id: previous?.id,
    current_revision_id: current?.id,
    header: {
      po_date: { before: previous?.po_date, after: current?.po_date },
      delivery_snapshot: { before: previous?.delivery_snapshot, after: current?.delivery_snapshot },
      commercial_snapshot: { before: previous?.commercial_snapshot, after: current?.commercial_snapshot },
      standard_terms_snapshot: { before: previous?.standard_terms_snapshot, after: current?.standard_terms_snapshot },
      totals: { before: { items_basic: previous?.total_basic_amount, gst: previous?.total_gst_amount, freight: previous?.total_freight_amount, total: previous?.total_amount }, after: { items_basic: current?.total_basic_amount, gst: current?.total_gst_amount, freight: current?.total_freight_amount, total: current?.total_amount } },
    },
    items: items.map((item) => ({ type: item.state, revision_line_key: item.revision_line_key, before: item.before, after: item.after })),
  };
  return { items, keyTerms: termComparisons, additionalCharges: chargeComparisons, standardTerms, rendererSnapshot };
}
