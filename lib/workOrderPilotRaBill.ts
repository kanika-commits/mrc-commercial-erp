export type PilotRaBillBreakdown = { id?: string; serial: string; description: string; cumulative_qty: number; current_qty?: number; prior_cumulative_qty?: number; release_percent: number; previous_amount?: number; remarks?: string };
export type PilotRaBillItem = { serial: string; description: string; wo_qty: number; unit: string; rate: number; breakdowns?: PilotRaBillBreakdown[]; cumulative_qty?: number; release_percent?: number; previous_amount?: number; remarks?: string };

export function formatPilotDate(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return "-";
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    if (!Number.isNaN(date.getTime())) { const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][date.getUTCMonth()]; return `${String(date.getUTCDate()).padStart(2, "0")}-${month}-${date.getUTCFullYear()}`; }
  }
  return "-";
}

export function formatPilotDateTime(value: unknown) {
  if (!value) return "-";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "-";
  const datePart = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(date).replaceAll(" ", "-"); const timePart = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" }).format(date); return `${datePart}, ${timePart}`;
}

const n = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const round = (value: number) => Number(value.toFixed(2));

export function calculatePilotRaBill(input: { items: PilotRaBillItem[]; gst_percent: number; security_cumulative?: number; security_current?: number; withheld?: number; labour_cess?: number; total_debit_notes?: number; total_credit_notes?: number; previous_basic?: number; previous_gst?: number; previous_security?: number }) {
  const items = input.items.map((item) => {
    const children = item.breakdowns || [];
    const cumulative_qty = children.length ? children.reduce((sum, child) => sum + n(child.cumulative_qty), 0) : n(item.cumulative_qty);
    const release = (value: unknown) => n(value) > 1 ? n(value) / 100 : n(value);
    const weighted = children.length ? children.reduce((sum, child) => sum + n(child.cumulative_qty) * release(child.release_percent), 0) / (cumulative_qty || 1) : release(item.release_percent);
    const cumulative_amount = children.length ? round(children.reduce((sum, child) => sum + (child.current_qty !== undefined ? n(child.previous_amount) + n(item.rate) * n(child.current_qty) * release(child.release_percent) : n(item.rate) * n(child.cumulative_qty) * release(child.release_percent)), 0)) : round(n(item.rate) * cumulative_qty * weighted);
    const previous_amount = children.length ? round(children.reduce((sum, child) => sum + n(child.previous_amount), 0)) : round(n(item.previous_amount));
    const breakdowns = children.map((child) => ({ ...child, cumulative_amount: child.current_qty !== undefined ? round(n(child.previous_amount) + n(item.rate) * n(child.current_qty) * release(child.release_percent)) : round(n(item.rate) * n(child.cumulative_qty) * release(child.release_percent)), current_amount: child.current_qty !== undefined ? round(n(item.rate) * n(child.current_qty) * release(child.release_percent)) : round(n(item.rate) * n(child.cumulative_qty) * release(child.release_percent) - n(child.previous_amount)) }));
    return { ...item, breakdowns, cumulative_qty, release_percent: weighted, wo_basic_amount: round(n(item.wo_qty) * n(item.rate)), cumulative_amount, previous_amount, current_amount: round(cumulative_amount - previous_amount) };
  });
  const basic = round(items.reduce((sum, item) => sum + item.cumulative_amount, 0));
  const gst = round(basic * n(input.gst_percent) / 100);
  const previousSecurity = round(n(input.previous_security));
  const currentSecurity = round(n(input.security_current ?? (input.security_cumulative === undefined ? 0 : n(input.security_cumulative) - previousSecurity)));
  const security = round(previousSecurity + currentSecurity);
  const previousBasic = round(n(input.previous_basic));
  const previousGst = round(n(input.previous_gst));
  const withheld = round(n(input.withheld));
  const labour_cess = round(n(input.labour_cess));
  const total_debit_notes = round(n(input.total_debit_notes));
  const total_credit_notes = round(n(input.total_credit_notes));
  const net = round(basic + gst - security);
  const adjusted_net_payable = round(net - withheld - labour_cess - total_debit_notes + total_credit_notes);
  return { items, cumulative_basic: basic, cumulative_gst: gst, cumulative_security: security, cumulative_net_payable: net, withheld, labour_cess, total_debit_notes, total_credit_notes, adjusted_net_payable, current_basic: round(basic - previousBasic), current_gst: round(gst - previousGst), current_security: currentSecurity, current_net_payable: round(net - round(previousBasic + previousGst - previousSecurity)), current_adjusted_net_payable: round(adjusted_net_payable - round(previousBasic + previousGst - previousSecurity)), warnings: [basic < previousBasic ? "Current basic value is below prior cumulative value." : "", gst < previousGst ? "Current GST is below prior cumulative value." : "", adjusted_net_payable < 0 ? "Adjusted Net Payable cannot be negative." : ""].filter(Boolean) };
}

export function validatePilotRaBill(result: ReturnType<typeof calculatePilotRaBill>, contractBasic: number) {
  return [...result.warnings, result.cumulative_basic > n(contractBasic) ? "Cumulative basic value exceeds the Work Order contract." : ""].filter(Boolean);
}
