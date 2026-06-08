# Formula & Validation Mapping

## Rule

Old system logic should not be copied blindly.

Each item becomes one of:

* Database field
* Calculated field
* Form validation
* Approval rule
* Master dropdown
* Document record

---

## Dropdown Masters

### Company

Move to `companies` table.

### Site

Move to `sites` table.

### Contractor / Vendor Type

Move to `vendor_types` master.

### WO Type

Move to `work_order_types` master.

### GST Rate

Move to `gst_rates` master.

Allowed values:

* 0%
* 5%
* 12%
* 18%
* 28%

### Debit Note Type

Move to `debit_note_types` master.

Examples:

* Material Recovery
* Penalty
* Damage
* Short Supply
* Other

---

## Validations

### Work Order

* Company is required
* Site is required
* WO Number is required
* WO Date is required
* WO Type is required
* Contractor/Vendor is required
* Duplicate WO Number is not allowed

### Vendor

* Vendor name is required
* Vendor type is required
* PAN format should be validated
* GSTIN format should be validated
* Aadhaar/CIN should be validated where applicable
* Contact person is required
* Contact number is required

### RA Bill

* Site is required
* WO Number is required
* Submitter name is required
* RA Bill number is required
* RA Bill date is required
* Value of work done is required
* GST rate is required
* Attachment is required

### Invoice

* WO Number is required
* Invoice number is required
* Invoice date is required
* Basic value is required
* GST rate is required
* Invoice attachment is required

### Payment

* WO Number is required
* Payment date is required
* Total payment is required
* TDS deducted is required
* Transferred amount should be calculated

---

## Calculated Fields

### RA Bill

GST Amount = Value of Work Done × GST Rate

Amount Payable = Value of Work Done - Security + GST Amount

### Invoice

GST = Basic Value × GST Rate

Total Amount = Basic Value + GST

### Payment

Transferred Amount = Total Payment - TDS Deducted

### Work Order Summary

Total Work Done = Sum of approved RA Bills

Total Invoice Value = Sum of invoices

Total Payments = Sum of payments

Total Debit Notes = Sum of debit notes

RA Bills - Invoices = Total RA Bill Payable - Total Invoice Value

RA Bills - Payments = Total RA Bill Payable - Total Payments

Invoices - Payments = Total Invoice Value - Total Payments

Amount Due = Total RA Bill Payable - Total Payments - Total Debit Notes

---

## Documents

All files should move into a central `documents` table.

Document can belong to:

* Vendor
* Work Order
* RA Bill
* Invoice
* Payment
* Debit Note

Fields:

* document_type
* file_name
* file_url
* uploaded_by
* uploaded_at
* related_table
* related_id

---

## Approval Rules

### Work Order Approval

Submitted Work Orders go to pending approval.

Approver can:

* Approve
* Suspend / Reject
* Add remark
* Review uploaded WO document

### RA Bill Approval

Submitted RA Bills go to HO approval.

Approver can:

* Approve
* Reject
* Add approval remark
* Add rejection remark
* View uploaded files
* Open WO folder

### ITC Review

Invoices can be:

* ITC Claimed
* Rejected

Reviewer can add remarks.

---

## ERP Principle

Do not store formulas as random spreadsheet columns.

Store raw transaction data.

Calculate totals from approved transactions.

Example:

Approved RA Bills → Total Work Done

Invoices → Total Invoice Value

Payments → Total Payments

Debit Notes → Total Deductions
