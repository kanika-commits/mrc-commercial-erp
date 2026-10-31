import crypto from "node:crypto";

export function pilotRaBillReviewBindingHash(input: {
  billId: string;
  organizationId: string;
  workOrderId: string;
  withheld: number;
  labourCess: number;
  calculationSnapshot: Record<string, unknown>;
}) {
  const canonical = {
    bill_id: input.billId,
    organization_id: input.organizationId,
    work_order_id: input.workOrderId,
    withheld: Number(input.withheld || 0),
    labour_cess: Number(input.labourCess || 0),
    calculation_snapshot: input.calculationSnapshot || {},
  };
  return crypto.createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}
