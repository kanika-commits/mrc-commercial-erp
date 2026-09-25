import { diffRevisionValue } from "./poRevisionComparison";
import type { RevisionField, RevisionItemComparison, RevisionState } from "./poRevisionComparison";
import { parsePurchaseOrderStandardTerms } from "./standardTerms";

export type RevisionRenderRun = { text: string; color: "normal" | "red"; strike: boolean };
export type RevisionRenderField = { runs: RevisionRenderRun[] };
export type RevisionRenderItem = { revision_line_key: string; state: RevisionState; fields: Record<string, RevisionRenderField>; before: Record<string, unknown> | null; after: Record<string, unknown> | null };
export type RevisionRenderTerm = { identity: string; state: RevisionState; label: string; value: RevisionRenderField };
export type RevisionRenderCharge = { identity: string; state: RevisionState; name: RevisionRenderField; amount: RevisionRenderField };
export type RevisionRenderClause = { identity: string; state: RevisionState; heading: RevisionRenderField; body: RevisionRenderField };
export type RevisionRenderModel = { items: RevisionRenderItem[]; keyTerms: RevisionRenderTerm[]; additionalCharges: RevisionRenderCharge[]; standardTerms: RevisionRenderClause[] };

export function revisionRuns<T>(field: RevisionField<T>, format: (value: T) => string): RevisionRenderRun[] {
  if (field.state === "unchanged") return [{ text: format(field.value), color: "normal", strike: false }];
  if (field.state === "added") return [{ text: format(field.after), color: "red", strike: false }];
  if (field.state === "removed") return [{ text: format(field.before), color: "normal", strike: true }];
  return [{ text: format(field.before), color: "normal", strike: true }, { text: format(field.after), color: "red", strike: false }];
}

function fieldRuns(field: RevisionField<unknown>, format: (value: unknown) => string) {
  return { runs: revisionRuns(field, format) };
}

function valueField(state: RevisionState, before: unknown, after: unknown) {
  return fieldRuns({ state, ...(state === "unchanged" ? { value: after } : state === "added" ? { after } : state === "removed" ? { before } : { before, after }) } as RevisionField<unknown>, (value) => String(value ?? ""));
}

function chargeAmountField(state: RevisionState, before: unknown, after: unknown) {
  const format = (value: unknown) => value == null || value === "" ? "" : `Rs. ${new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value))}`;
  return fieldRuns({ state, ...(state === "unchanged" ? { value: after } : state === "added" ? { after } : state === "removed" ? { before } : { before, after }) } as RevisionField<unknown>, format);
}

export function buildPurchaseOrderRevisionPdfRenderModel(current: any, comparison?: any): any {
  if (!comparison) return current;
  const parsedCurrentTerms = parsePurchaseOrderStandardTerms(current?.standard_terms_snapshot);
  const currentTerms = parsedCurrentTerms?.kind === "structured"
    ? parsedCurrentTerms.clauses.map((clause: any, index: number) => ({ identity: String(clause.id ?? `clause-${index + 1}`), state: "unchanged", heading: { runs: [{ text: clause.heading, color: "normal", strike: false }] }, body: { runs: [{ text: clause.clause_body, color: "normal", strike: false }] } }))
    : parsedCurrentTerms?.kind === "text"
      ? [{ identity: "legacy-terms", state: "unchanged", heading: { runs: [{ text: "", color: "normal", strike: false }] }, body: { runs: [{ text: parsedCurrentTerms.text, color: "normal", strike: false }] } }]
      : [];
  const totalsBefore = comparison.rendererSnapshot?.header?.totals?.before || {};
  const totalsAfter = comparison.rendererSnapshot?.header?.totals?.after || {};
  const summary = Object.fromEntries(Object.entries({ itemsBasic: "items_basic", gst: "gst", freight: "freight", total: "total" }).map(([key, source]) => [key, fieldRuns(diffRevisionValue(totalsBefore[source], totalsAfter[source]) as any, (value) => `Rs. ${Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)]));
  return {
    items: comparison.items.map((item: any) => ({
      revision_line_key: item.revision_line_key,
      state: item.state,
      before: item.before,
      after: item.after,
      fields: Object.fromEntries(Object.entries(item.fields).map(([key, field]) => [key, fieldRuns(field as RevisionField<unknown>, (value) => key === "gst_rate" ? `${value ?? 0}%` : String(value ?? ""))])),
    })),
    keyTerms: comparison.keyTerms.map((term: any) => {
      const source = (current?.commercial_snapshot?.key_terms || []).find((value: any) => String(value?.id ?? value?.key ?? value?.code ?? value?.description ?? value?.label ?? "") === term.identity);
      return { ...term, label: String(source?.label ?? source?.name ?? term.identity), value: valueField(term.state, term.before, term.after) };
    }),
    additionalCharges: comparison.additionalCharges.map((charge: any) => ({
      ...charge,
      name: valueField(charge.state, charge.before?.name, charge.after?.name),
      amount: chargeAmountField(charge.state, charge.before?.amount, charge.after?.amount),
    })),
    standardTerms: currentTerms,
    summary,
  };
}
