type CompanyLike = {
  company_code?: string | null;
  company_name?: string | null;
};

const COMPANY_ORDER_BY_CODE: Record<string, number> = {
  MRC: 1,
  MRCTS: 2,
  GLC: 3,
  PI: 4,
};

const COMPANY_ORDER_BY_NAME: Record<string, number> = {
  "mrc infracon ltd.": 1,
  "mrc tech solutions pvt. ltd.": 2,
  "girdhari lal constructions pvt. ltd.": 3,
  "puspa infracon": 4,
};

function normalize(value?: string | null) {
  return String(value || "").trim().toLowerCase();
}

export function companySortPriority(company: CompanyLike) {
  const code = String(company.company_code || "").trim().toUpperCase();
  const name = normalize(company.company_name);

  return (
    COMPANY_ORDER_BY_CODE[code] ||
    COMPANY_ORDER_BY_NAME[name] ||
    Number.MAX_SAFE_INTEGER
  );
}

export function compareCompanies<T extends CompanyLike>(a: T, b: T) {
  const priorityDiff = companySortPriority(a) - companySortPriority(b);

  if (priorityDiff !== 0) return priorityDiff;

  return normalize(a.company_name || a.company_code).localeCompare(
    normalize(b.company_name || b.company_code)
  );
}

export function sortCompanies<T extends CompanyLike>(companies: T[] | null | undefined) {
  return [...(companies || [])].sort(compareCompanies);
}
