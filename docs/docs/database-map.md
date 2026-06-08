# MRC Commercial ERP – Database Relationship Map

## Core Hierarchy

Organization
→ Company
→ Site / Project
→ Work Order

## Vendor Relationship

A Work Order can have multiple vendors/contractors.

Work Order
→ Work Order Vendors
→ Vendor Master

Examples:

- Main Contractor
- Subcontractor
- Consultant
- Labour Contractor
- Rental Vendor
- Supplier

## Transaction Flow

Work Order
→ RA Bills
→ Invoices
→ Payments
→ Debit Notes
→ Documents

## Main Tables

### organizations
Top-level tenant.

### companies
Companies/legal entities under one organization.

### sites
Projects/sites under companies.

### vendors
All contractors, subcontractors, consultants, suppliers, rental vendors.

### vendor_contacts
Multiple contacts per vendor.

### vendor_documents
PAN, GSTIN, Aadhaar/CIN, bank docs, other documents.

### work_orders
Main work order record.

### work_order_vendors
Links one work order to one or more vendors.

Fields:
- work_order_id
- vendor_id
- vendor_role
- is_primary

### ra_bills
RA bills raised under a work order and vendor.

### invoices
Invoices against work order / vendor / RA bill.

### payments
Payments against work order / vendor / invoice.

### debit_notes
Debit notes against work order / vendor.

### documents
Central document table for all files.

### approval_requests
Common approval workflow table.

## Key Rule

Every business table must have:

organization_id

This keeps MRC data separate from future client/company data.