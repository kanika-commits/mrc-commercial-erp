export type PaymentGridField =
  | "company"
  | "payment_type"
  | "reference"
  | "from_account"
  | "party"
  | "payment_date"
  | "total_payment"
  | "tds_amount";

const PAYMENT_GRID_FIELDS: Array<PaymentGridField | null> = [
  "company",
  "payment_type",
  "reference",
  "from_account",
  "party",
  "payment_date",
  "total_payment",
  "tds_amount",
  null, // transferred amount is calculated
  null, // row action
];

export type PaymentGridPasteRow = {
  rowIndex: number;
  values: Partial<Record<PaymentGridField, string>>;
};

export function mapPaymentGridPaste(text: string, startRow: number, startColumn: number): PaymentGridPasteRow[] {
  const lines = text.replace(/\r/g, "").split("\n");
  while (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();

  return lines.map((line, rowOffset) => {
    const values: Partial<Record<PaymentGridField, string>> = {};
    line.split("\t").forEach((value, columnOffset) => {
      const field = PAYMENT_GRID_FIELDS[startColumn + columnOffset];
      if (field) values[field] = value.trim();
    });
    return { rowIndex: startRow + rowOffset, values };
  });
}

export function matchPaymentOption<T>(value: string, options: T[], labels: (option: T) => string[]): T | null {
  const normalized = normalize(value);
  if (!normalized) return null;
  const matches = options.filter((option) => labels(option).some((label) => normalize(label) === normalized));
  return matches.length === 1 ? matches[0] : null;
}

export function normalizePaymentDate(value: string) {
  const text = value.trim();
  if (!text) return "";
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return validIsoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const parts = text.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/);
  if (parts) {
    const first = Number(parts[1]);
    const second = Number(parts[2]);
    const day = first > 12 ? first : second > 12 ? second : first;
    const month = first > 12 ? second : second > 12 ? first : second;
    return validIsoDate(Number(parts[3]), month, day);
  }

  const serial = Number(text);
  if (Number.isInteger(serial) && serial >= 1 && serial <= 2_958_465) {
    const date = new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000);
    return date.toISOString().slice(0, 10);
  }
  return null;
}

function validIsoDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

function normalize(value: unknown) {
  return String(value ?? "").trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

export type PaymentRegisterFilters = {
  companyId?: string;
  paymentType?: string;
  party?: string;
  fromAccount?: string;
  dateFrom?: string;
  dateTo?: string;
  status?: string;
  createdBy?: string;
};

export function filterPaymentRegisterRows<T extends Record<string, any>>(rows: T[], filters: PaymentRegisterFilters) {
  return rows.filter((row) => {
    if (filters.companyId && row.company_id !== filters.companyId) return false;
    if (filters.paymentType && row.payment_type !== filters.paymentType) return false;
    if (filters.party && (row.party || row.vendor_name || "") !== filters.party) return false;
    if (filters.fromAccount && (row.account_name || "") !== filters.fromAccount) return false;
    if (filters.dateFrom && String(row.payment_date || "") < filters.dateFrom) return false;
    if (filters.dateTo && String(row.payment_date || "") > filters.dateTo) return false;
    if (filters.status && String(row.status || "") !== filters.status) return false;
    if (filters.createdBy && (row.created_by_filter_value || "") !== filters.createdBy) return false;
    return true;
  });
}

export function paymentRegisterFilterOptions(rows: Array<Record<string, any>>, field: string) {
  return Array.from(new Set(rows.map((row) => String(row[field] || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

export function transferredPaymentAmount(total: unknown, tds: unknown) {
  return Math.round(Number(total || 0)) - Math.round(Number(tds || 0));
}
