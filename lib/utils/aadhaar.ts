export type AadhaarValidationResult =
  | { valid: true; digits: string; formatted: string }
  | { valid: false; digits: string; formatted: string; error: string };

const SUPPORTED_AADHAAR_INPUT = /^[0-9\s-]*$/;

export function normalizeAadhaar(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return text.replace(/[\s-]/g, "");
}

export function formatAadhaar(value: unknown) {
  const digits = normalizeAadhaar(value).replace(/\D/g, "").slice(0, 12);
  return digits.replace(/(\d{4})(?=\d)/g, "$1-");
}

export function aadhaarInputValue(value: unknown) {
  return formatAadhaar(String(value ?? "").replace(/\D/g, ""));
}

export function validateAadhaar(value: unknown): AadhaarValidationResult {
  const text = String(value ?? "").trim();
  const digits = normalizeAadhaar(text);
  if (!text) {
    return { valid: false, digits: "", formatted: "", error: "Aadhaar Number is required when Aadhaar Available is Yes." };
  }
  if (!SUPPORTED_AADHAAR_INPUT.test(text)) {
    return { valid: false, digits, formatted: formatAadhaar(digits), error: "Aadhaar Number may contain only digits, spaces or dashes." };
  }
  if (!/^\d{12}$/.test(digits)) {
    return { valid: false, digits, formatted: formatAadhaar(digits), error: "Aadhaar Number must contain exactly 12 digits." };
  }
  return { valid: true, digits, formatted: formatAadhaar(digits) };
}

export function optionalFormattedAadhaar(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return { formatted: null as string | null, error: "" };
  const validation = validateAadhaar(text);
  if (!validation.valid) return { formatted: null, error: validation.error };
  return { formatted: validation.formatted, error: "" };
}
