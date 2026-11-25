import { createPrivateStorageAdapter } from "@/lib/storage/privateStorage";

type AdminClient = any;

export type EmployeeSignatureBlock = {
  employeeId: string;
  userId: string | null;
  employeeName: string | null;
  employeeCode: string | null;
  designation: string | null;
  department: string | null;
  company: string | null;
  site: string | null;
  displayTitle: string | null;
  initials: string | null;
  signatureImageUrl: string | null;
  storageBucket: string | null;
  storageKey: string | null;
};

export async function getEmployeeSignatureBlock(
  admin: AdminClient,
  input: { employeeId?: string | null; userId?: string | null; signatureProfileId?: string | null; expiresIn?: number; includeSignedUrl?: boolean },
): Promise<EmployeeSignatureBlock | null> {
  let query = admin
    .from("hr_employees")
    .select("id, user_id, employee_code, employee_name, organization_id, company:companies(company_name), site:sites(site_name), department:hr_departments(department_name), designation:hr_designations(designation_name)")
    .neq("status", "deleted")
    .limit(1)
    .maybeSingle();

  if (input.employeeId) {
    query = query.eq("id", input.employeeId);
  } else if (input.userId) {
    query = query.eq("user_id", input.userId);
  } else {
    return null;
  }

  const { data: employee, error: employeeError } = await query;
  if (employeeError) throw employeeError;
  if (!employee) return null;

  let signatureQuery = admin
    .from("employee_signature_profiles")
    .select("id, storage_provider, storage_bucket, storage_key, initials, display_title, is_active")
    .eq("employee_id", employee.id)
    .eq("is_active", true);
  if (input.signatureProfileId) signatureQuery = signatureQuery.eq("id", input.signatureProfileId);
  const { data: signature, error: signatureError } = await signatureQuery.maybeSingle();

  if (signatureError) throw signatureError;

  let signatureImageUrl: string | null = null;
  if (input.includeSignedUrl !== false && signature?.storage_bucket && signature?.storage_key) {
    signatureImageUrl = await createPrivateStorageAdapter(admin).createSignedReadUrl({
      bucket: signature.storage_bucket,
      key: signature.storage_key,
      expiresIn: input.expiresIn || 60 * 10,
    });
  }

  return {
    employeeId: employee.id,
    userId: employee.user_id || null,
    employeeName: employee.employee_name || null,
    employeeCode: employee.employee_code || null,
    designation: employee.designation?.designation_name || null,
    department: employee.department?.department_name || null,
    company: employee.company?.company_name || null,
    site: employee.site?.site_name || null,
    displayTitle: signature?.display_title || null,
    initials: signature?.initials || null,
    signatureImageUrl,
    storageBucket: signature?.storage_bucket || null,
    storageKey: signature?.storage_key || null,
  };
}
