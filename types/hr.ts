export type HrDepartment = {
  id: string;
  organization_id?: string;
  department_name: string;
  department_code?: string | null;
  status?: string | null;
};

export type HrDesignation = {
  id: string;
  organization_id?: string;
  department_id?: string | null;
  designation_name: string;
  designation_code?: string | null;
  status?: string | null;
};

export type HrEmployee = {
  id: string;
  organization_id: string;
  company_id: string;
  site_id?: string | null;
  employee_code: string;
  employee_name: string;
  email?: string | null;
  phone?: string | null;
  department_id?: string | null;
  designation_id?: string | null;
  reporting_manager_id?: string | null;
  date_of_joining?: string | null;
  employment_type?: string | null;
  status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type ReimbursementClaim = {
  id: string;
  organization_id: string;
  company_id: string;
  site_id?: string | null;
  employee_id: string;
  claim_number: string;
  claim_date: string;
  claim_type?: string | null;
  description?: string | null;
  amount: number;
  gst_amount: number;
  total_amount: number;
  approved_amount?: number | null;
  status: string;
  approval_status?: string | null;
  submitted_at?: string | null;
  approved_by_name?: string | null;
  approved_by_email?: string | null;
  approved_at?: string | null;
  rejected_by_name?: string | null;
  rejected_by_email?: string | null;
  rejected_at?: string | null;
  rejection_reason?: string | null;
  payment_id?: string | null;
  created_by_name?: string | null;
  created_by_email?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type ReimbursementDocument = {
  id: string;
  reimbursement_claim_id: string;
  document_type?: string | null;
  file_name?: string | null;
  mime_type?: string | null;
  uploaded_at?: string | null;
  uploaded_by_name?: string | null;
  uploaded_by_email?: string | null;
  signed_url?: string | null;
  signed_url_error?: string | null;
};

export type ReimbursementHistoryRow = {
  id: string;
  reimbursement_claim_id: string;
  from_status?: string | null;
  to_status: string;
  action: string;
  remarks?: string | null;
  changed_by_name?: string | null;
  changed_by_email?: string | null;
  changed_at: string;
};

export type LookupOption = {
  id: string;
  label: string;
  meta?: string;
};
