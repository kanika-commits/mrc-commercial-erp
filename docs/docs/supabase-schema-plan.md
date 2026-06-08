# Supabase Schema Plan – MRC Commercial ERP

## Vision

Build a construction-focused ERP for MRC Group that can later support multiple organizations without mixing data.

Every business table must contain:

organization_id

This allows future SaaS expansion while keeping customer data isolated.

---

# Phase 1 Core Tables

## organizations

Stores ERP tenants.

Examples:

* MRC Group
* ABC Infra
* XYZ Developers

Fields:

* id
* name
* code
* status
* created_at

---

## profiles

Stores ERP users linked to Supabase Auth.

Fields:

* id
* organization_id
* full_name
* email
* status
* created_at

---

## roles

Stores ERP roles.

Examples:

* Platform Owner
* Super Admin
* HO Approver
* HO User
* Site User
* Accounts User
* Accounts Manager
* Viewer

Fields:

* id
* organization_id
* role_name
* description
* created_at

---

## permissions

Stores permissions.

Examples:

Module:

* companies
* sites
* vendors
* work_orders
* ra_bills
* invoices
* payments
* debit_notes
* reports
* documents
* admin

Actions:

* view
* add
* edit
* delete
* upload
* approve
* reject

Fields:

* id
* module
* action

---

## role_permissions

Maps roles to permissions.

Fields:

* id
* role_id
* permission_id

---

# Master Data

## companies

Examples:

* MRC Infracon Limited
* MRC Tech Solutions Pvt. Ltd.
* Girdhari Lal Constructions Pvt. Ltd.
* Pushpa Infracon

Fields:

* id
* organization_id
* company_name
* company_code
* status
* created_at

---

## sites

Fields:

* id
* organization_id
* company_id
* site_name
* site_code
* location
* state
* status
* created_at

---

## vendors

Vendor master.

Fields:

* id
* organization_id
* vendor_name
* vendor_type
* pan
* gstin
* aadhaar_cin
* msme_registered
* msme_number
* msme_type
* msme_certificate_expiry_date
* status
* created_at

Vendor Types:

* Main Contractor
* Subcontractor
* Consultant
* Supplier
* Labour Contractor
* Equipment Rental

---

## vendor_contacts

Stores multiple contacts per vendor.

Fields:

* id
* vendor_id
* contact_name
* contact_number
* email
* designation
* is_primary
* created_at

---

## vendor_bank_accounts

Stores vendor bank details.

Fields:

* id
* vendor_id
* account_holder_name
* account_number
* ifsc_code
* bank_name
* branch_name
* is_primary
* created_at

---

## vendor_documents

Stores vendor-specific documents.

Fields:

* id
* vendor_id
* document_type
* file_name
* file_url
* uploaded_at

Document Types:

* PAN
* GST_CERTIFICATE
* AADHAAR_CIN
* BANK_PROOF
* MSME_CERTIFICATE
* ADDITIONAL_DOCUMENT

---

# Commercial Transactions

## work_orders

Fields:

* id
* organization_id
* company_id
* site_id
* wo_number
* wo_date
* wo_type
* description
* status
* created_by
* approved_by
* approved_at
* created_at

---

## work_order_vendors

Allows one work order to have multiple vendors.

Fields:

* id
* organization_id
* work_order_id
* vendor_id
* vendor_role
* is_primary
* created_at

Vendor Roles:

* Main Contractor
* Subcontractor
* Consultant
* Supplier
* Labour Contractor
* Equipment Rental

---

## ra_bills

Fields:

* id
* organization_id
* work_order_id
* vendor_id
* ra_bill_number
* ra_bill_date
* value_of_work_done
* security
* gst_rate
* gst_amount
* amount_payable
* status
* submitted_by
* approved_by
* approved_at
* created_at

Calculated:

gst_amount = value_of_work_done × gst_rate

amount_payable = value_of_work_done - security + gst_amount

---

## invoices

Fields:

* id
* organization_id
* work_order_id
* vendor_id
* ra_bill_id
* invoice_number
* invoice_date
* basic_value
* gst_rate
* gst_amount
* total_amount
* itc_status
* itc_reviewed_by
* itc_reviewed_at
* created_at

Calculated:

gst_amount = basic_value × gst_rate

total_amount = basic_value + gst_amount

---

## payments

Fields:

* id
* organization_id
* work_order_id
* vendor_id
* invoice_id
* payment_date
* total_payment
* tds_deducted
* transferred_amount
* payment_reference
* remarks
* created_by
* created_at

Calculated:

transferred_amount = total_payment - tds_deducted

---

## debit_notes

Fields:

* id
* organization_id
* work_order_id
* vendor_id
* debit_note_date
* debit_note_type
* total_amount
* reason
* status
* submitted_by
* approved_by
* approved_at
* created_at

---

# Documents

## documents

Central document repository.

Fields:

* id
* organization_id
* related_table
* related_id
* document_type
* file_name
* file_url
* uploaded_by
* uploaded_at

Document Types:

* WORK_ORDER_FILE
* RA_BILL_FILE
* INVOICE_FILE
* PAYMENT_PROOF
* DEBIT_NOTE_FILE
* OTHER

---

# Approvals

## approval_requests

Common approval workflow.

Fields:

* id
* organization_id
* related_table
* related_id
* approval_type
* status
* submitted_by
* submitted_at
* reviewed_by
* reviewed_at
* approval_remark
* rejection_remark

Approval Types:

* WORK_ORDER_APPROVAL
* RA_BILL_APPROVAL
* DEBIT_NOTE_APPROVAL
* ITC_REVIEW

Statuses:

* Pending
* Approved
* Rejected

---

# Formula Rules

RA Bill GST

gst_amount = value_of_work_done × gst_rate

RA Bill Payable

amount_payable = value_of_work_done - security + gst_amount

Invoice GST

gst_amount = basic_value × gst_rate

Invoice Total

total_amount = basic_value + gst_amount

Payment Transfer

transferred_amount = total_payment - tds_deducted

Dashboard Calculations

Total Work Done = Sum of Approved RA Bills

Total Invoice Value = Sum of Invoices

Total Payments = Sum of Payments

Total Debit Notes = Sum of Debit Notes

RA Bills - Invoices

Total RA Bill Payable - Total Invoice Value

RA Bills - Payments

Total RA Bill Payable - Total Payments

Invoices - Payments

Total Invoice Value - Total Payments

Amount Due

Total RA Bill Payable - Total Payments - Total Debit Notes

---

# Build Order

1. Organizations
2. Profiles
3. Companies
4. Sites
5. Vendors
6. Vendor Contacts
7. Vendor Bank Accounts
8. Vendor Documents
9. Work Orders
10. Work Order Vendors
11. RA Bills
12. Invoices
13. Payments
14. Debit Notes
15. Documents
16. Approval Requests
17. Roles & Permissions
