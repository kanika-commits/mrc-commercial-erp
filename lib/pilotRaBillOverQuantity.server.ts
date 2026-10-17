export const PILOT_OVER_QUANTITY_DEFAULT_PERCENT = 0;

export type PilotOverQuantityPolicy = {
  organization_id: string;
  allowance_percent: number;
  configured_by?: string | null;
  configured_at?: string | null;
};

export async function getPilotOverQuantityPolicy(admin: any, organizationId: string): Promise<PilotOverQuantityPolicy> {
  const result = await admin.from("pilot_ra_bill_over_quantity_policies").select("organization_id,allowance_percent,configured_by,configured_at").eq("organization_id", organizationId).maybeSingle();
  if (result.error) {
    if (/relation .* does not exist|column .* does not exist/i.test(result.error.message)) return { organization_id: organizationId, allowance_percent: PILOT_OVER_QUANTITY_DEFAULT_PERCENT };
    throw result.error;
  }
  const allowance = Number(result.data?.allowance_percent ?? PILOT_OVER_QUANTITY_DEFAULT_PERCENT);
  return { ...(result.data || {}), organization_id: organizationId, allowance_percent: Number.isFinite(allowance) && allowance >= 0 ? allowance : PILOT_OVER_QUANTITY_DEFAULT_PERCENT };
}

export function pilotQuantityUsage(items: any[]) {
  return (items || []).map((item: any) => {
    const children = Array.isArray(item.breakdowns) ? item.breakdowns : [];
    const quantity = children.length ? children.reduce((sum: number, child: any) => sum + Math.max(0, Number(child.cumulative_qty) || 0), 0) : Math.max(0, Number(item.cumulative_qty) || 0);
    const workOrderQuantity = Math.max(0, Number(item.wo_qty ?? item.quantity) || 0);
    return { serial: String(item.serial || item.parent_serial || ""), quantity, workOrderQuantity, over: quantity > workOrderQuantity };
  });
}

export function pilotQuantityLimit(workOrderQuantity: number, allowancePercent: number) {
  return workOrderQuantity * (1 + Math.max(0, allowancePercent) / 100);
}
