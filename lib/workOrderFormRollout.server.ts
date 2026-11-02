import { NextResponse } from "next/server";

export const WORK_ORDER_FORM_MODES = ["legacy", "pilot", "both"] as const;
export type WorkOrderFormMode = (typeof WORK_ORDER_FORM_MODES)[number];

export async function getWorkOrderFormMode(admin: any, organizationId: string): Promise<WorkOrderFormMode> {
  const result = await admin.from("work_order_form_rollouts").select("mode").eq("organization_id", organizationId).maybeSingle();
  if (result.error && !/relation .* does not exist|schema cache/i.test(result.error.message || "")) throw result.error;
  return WORK_ORDER_FORM_MODES.includes(result.data?.mode) ? result.data.mode : "legacy";
}

export function formModeAllows(mode: WorkOrderFormMode, form: "legacy" | "pilot") {
  return mode === "both" || mode === form;
}

export async function requireWorkOrderFormMode(admin: any, organizationId: string, form: "legacy" | "pilot") {
  const mode = await getWorkOrderFormMode(admin, organizationId);
  if (!formModeAllows(mode, form)) return { response: NextResponse.json({ error: `The ${form} Work Order form is not enabled for this organization.` }, { status: 403 }) } as const;
  return { mode } as const;
}
