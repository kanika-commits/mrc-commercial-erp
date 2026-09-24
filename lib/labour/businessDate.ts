export type BusinessDateResult = { value: string | null; error?: string };

export function validateLabourBusinessDate(value: unknown): BusinessDateResult {
  const text = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return { value: null, error: "Date must use the YYYY-MM-DD format." };
  }
  const [year, month, day] = text.split("-").map(Number);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (candidate.getUTCFullYear() !== year || candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== day) {
    return { value: null, error: "Date must be a valid calendar date." };
  }
  return { value: text };
}
