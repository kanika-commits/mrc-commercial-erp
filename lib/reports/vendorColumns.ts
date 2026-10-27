export const VENDOR_COLUMNS = ["vendor_name", "gstin", "pan", "phone", "email", "status", "created_on", "created_by"] as const;
export type VendorColumn = typeof VENDOR_COLUMNS[number];
export function normalizeVendorColumns(input: string[] | null | undefined): VendorColumn[] {
  const requested = new Set(input || []);
  return VENDOR_COLUMNS.filter((column) => column === "vendor_name" || requested.has(column));
}
