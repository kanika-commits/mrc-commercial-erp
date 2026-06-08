# MRC Commercial ERP – Architecture Foundation

## Vision

Build a construction-focused commercial ERP that initially serves MRC Group and can later support multiple organizations on the same platform without mixing data.

---

# Core Hierarchy

Organization
→ Company
→ Site / Project
→ Work Order
→ RA Bill
→ Invoice
→ Payment
→ Debit Note
→ Documents

---

# Master Data

## Organizations

Top-level tenant.

Examples:

* MRC Group
* ABC Infra
* XYZ Developers

---

## Companies

Legal entities within an organization.

Examples:

* MRC Construction
* MRC Infrastructure

---

## Sites / Projects

Project locations.

Examples:

* CRPF HQ
* IIIT Sonipat
* Bus Terminal

---

## Vendors

Contractors, consultants, suppliers.

Stores:

* GSTIN
* PAN
* Bank Details
* Contacts
* Documents

---

## Users

ERP users.

Examples:

* Site Engineer
* Site Manager
* Commercial Executive
* Accounts Manager
* Super Admin

---

## Roles

Examples:

* Platform Owner
* Super Admin
* Commercial Manager
* Accounts Manager
* Site User
* Viewer

---

# Commercial Transactions

## Work Orders

Stores:

* WO Number
* WO Date
* Vendor
* Site
* Value
* WO Type
* Description
* Status

Supports:

* Revisions
* Attachments
* Approval Workflow

---

## RA Bills

Submitted against Work Orders.

Stores:

* RA Number
* Date
* Work Done Value
* GST
* Payable Amount
* Documents

Statuses:

* Draft
* Submitted
* Approved
* Rejected

---

## Invoices

Generated against approved RA Bills.

Stores:

* Invoice Number
* Invoice Date
* GST
* ITC Status
* Attachments

---

## Payments

Stores:

* Payment Date
* Amount
* TDS
* UTR
* Payment Proof

---

## Debit Notes

Stores:

* Amount
* Reason
* Supporting Documents

---

# Documents

Every transaction can have documents.

Supported Types:

* Work Order
* Agreement
* BOQ
* RA Bill
* Invoice
* Payment Proof
* Debit Note
* Vendor Documents

---

# Approval Engine

Phase 1:

* Work Order Approval
* RA Bill Approval
* Invoice Review
* ITC Review

Phase 2:

* Configurable Approval Matrix

---

# Multi-Tenant Rule

Every business table must contain:

organization_id

This ensures:

MRC cannot see ABC data.
ABC cannot see XYZ data.

---

# Future Modules

## Procurement

* Purchase Orders
* Material Receipts
* Vendor Bills

## Inventory

* Stores
* Stock
* Material Issue

## Labour

* Attendance
* Wage Bills

## Plant & Machinery

* Equipment
* Fuel
* Maintenance

## Project Costing

* Budget
* Actual Cost
* Profitability

## Client Billing

* Client RA Bills
* Receipts
* Retention
