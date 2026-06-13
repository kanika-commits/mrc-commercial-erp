


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."approvals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "related_table" "text" NOT NULL,
    "related_id" "uuid" NOT NULL,
    "approval_type" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "submitted_by" "uuid",
    "submitted_at" timestamp with time zone DEFAULT "now"(),
    "reviewed_by" "uuid",
    "reviewed_at" timestamp with time zone,
    "approval_remark" "text",
    "rejection_remark" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."approvals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."companies" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "company_name" "text" NOT NULL,
    "company_code" "text",
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."companies" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."company_bank_accounts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "company_id" "uuid" NOT NULL,
    "bank_name" "text" NOT NULL,
    "account_number" "text" NOT NULL,
    "ifsc" "text",
    "is_default" boolean DEFAULT false,
    "status" "text" DEFAULT 'active'::"text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."company_bank_accounts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."debit_note_documents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid",
    "debit_note_id" "uuid",
    "file_name" "text",
    "file_url" "text",
    "uploaded_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."debit_note_documents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."debit_notes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid",
    "work_order_id" "uuid",
    "ra_bill_id" "uuid",
    "vendor_id" "uuid",
    "debit_note_number" "text" NOT NULL,
    "debit_note_date" "date",
    "debit_note_type" "text",
    "reason" "text",
    "gross_amount" numeric DEFAULT 0,
    "gst_amount" numeric DEFAULT 0,
    "total_amount" numeric DEFAULT 0,
    "status" "text" DEFAULT 'Draft'::"text",
    "approval_status" "text" DEFAULT 'Pending'::"text",
    "created_by_name" "text",
    "created_by_email" "text",
    "approved_by_name" "text",
    "approved_by_email" "text",
    "approved_at" timestamp with time zone,
    "rejected_by_name" "text",
    "rejected_by_email" "text",
    "rejected_at" timestamp with time zone,
    "rejection_reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "is_deleted" boolean DEFAULT false
);


ALTER TABLE "public"."debit_notes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."erp_module_groups" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "module_code" "text" NOT NULL,
    "module_name" "text" NOT NULL,
    "route" "text" NOT NULL,
    "sort_order" integer,
    "status" "text" DEFAULT 'active'::"text"
);


ALTER TABLE "public"."erp_module_groups" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."erp_modules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "module_group" "text" NOT NULL,
    "module_code" "text" NOT NULL,
    "module_name" "text" NOT NULL,
    "route" "text" NOT NULL,
    "sort_order" integer DEFAULT 0,
    "status" "text" DEFAULT 'active'::"text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."erp_modules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invoice_documents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "invoice_id" "uuid" NOT NULL,
    "file_name" "text",
    "file_url" "text",
    "uploaded_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."invoice_documents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invoices" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "ra_bill_id" "uuid",
    "vendor_id" "uuid" NOT NULL,
    "invoice_number" "text" NOT NULL,
    "invoice_date" "date",
    "taxable_amount" numeric DEFAULT 0,
    "gst_rate" numeric DEFAULT 18,
    "gst_amount" numeric DEFAULT 0,
    "invoice_amount" numeric DEFAULT 0,
    "status" "text" DEFAULT 'Draft'::"text",
    "approval_status" "text" DEFAULT 'Pending'::"text",
    "remarks" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "work_order_id" "uuid",
    "created_by_name" "text",
    "created_by_email" "text",
    "itc_claimed_by_name" "text",
    "itc_claimed_by_email" "text",
    "itc_claimed_at" timestamp with time zone,
    "itc_rejected_by_name" "text",
    "itc_rejected_by_email" "text",
    "itc_rejected_at" timestamp with time zone,
    "itc_rejection_reason" "text",
    "itc_status" "text" DEFAULT 'Pending'::"text",
    "is_deleted" boolean DEFAULT false
);


ALTER TABLE "public"."invoices" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."organization_modules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "module_code" "text" NOT NULL,
    "enabled" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."organization_modules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."organizations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "code" "text" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."organizations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payment_documents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid",
    "payment_id" "uuid",
    "file_name" "text",
    "file_url" "text",
    "uploaded_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."payment_documents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "work_order_id" "uuid",
    "vendor_id" "uuid",
    "invoice_id" "uuid",
    "payment_number" "text" NOT NULL,
    "payment_date" "date",
    "payment_amount" numeric DEFAULT 0,
    "payment_mode" "text",
    "utr_number" "text",
    "status" "text" DEFAULT 'Draft'::"text",
    "remarks" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "total_payment" numeric DEFAULT 0,
    "tds_amount" numeric DEFAULT 0,
    "transferred_amount" numeric DEFAULT 0,
    "payment_type" "text",
    "from_account_no" "text",
    "reference_number" "text",
    "company_bank_account_id" "uuid",
    "created_by_name" "text",
    "created_by_email" "text",
    "created_at_user" timestamp with time zone,
    "company_id" "uuid",
    "is_deleted" boolean DEFAULT false
);


ALTER TABLE "public"."payments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "full_name" "text",
    "status" "text" DEFAULT 'active'::"text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ra_bill_documents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "ra_bill_id" "uuid" NOT NULL,
    "file_name" "text",
    "file_url" "text",
    "uploaded_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."ra_bill_documents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ra_bills" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "work_order_id" "uuid" NOT NULL,
    "vendor_id" "uuid" NOT NULL,
    "ra_number" "text" NOT NULL,
    "ra_date" "date",
    "gross_amount" numeric(15,2),
    "recovery_amount" numeric(15,2) DEFAULT 0,
    "retention_amount" numeric(15,2) DEFAULT 0,
    "net_amount" numeric(15,2),
    "status" "text" DEFAULT 'draft'::"text",
    "approval_status" "text" DEFAULT 'pending'::"text",
    "remarks" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "created_by_name" "text",
    "created_by_email" "text",
    "approved_by_name" "text",
    "approved_by_email" "text",
    "approved_at" timestamp with time zone,
    "rejected_by_name" "text",
    "rejected_by_email" "text",
    "rejected_at" timestamp with time zone,
    "rejection_reason" "text",
    "gst_rate" numeric DEFAULT 0,
    "gst_amount" numeric DEFAULT 0,
    "is_deleted" boolean DEFAULT false
);


ALTER TABLE "public"."ra_bills" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."role_permissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "role_id" "uuid" NOT NULL,
    "module_code" "text" NOT NULL,
    "action_code" "text" NOT NULL,
    "allowed" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."role_permissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."roles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "role_name" "text" NOT NULL,
    "role_code" "text" NOT NULL,
    "status" "text" DEFAULT 'active'::"text",
    "is_system_role" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."roles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sites" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "company_id" "uuid" NOT NULL,
    "site_name" "text" NOT NULL,
    "site_code" "text",
    "location" "text",
    "state" "text",
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."sites" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_access_assignments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "company_id" "uuid",
    "site_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "organization_id" "uuid"
);


ALTER TABLE "public"."user_access_assignments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_permission_overrides" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "module_code" "text" NOT NULL,
    "action_code" "text" NOT NULL,
    "allowed" boolean NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."user_permission_overrides" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_permissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "module_code" "text" NOT NULL,
    "action_code" "text" NOT NULL,
    "allowed" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."user_permissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_roles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."user_roles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vendor_bank_accounts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "vendor_id" "uuid" NOT NULL,
    "account_holder_name" "text",
    "account_number" "text",
    "ifsc_code" "text",
    "bank_name" "text",
    "branch_name" "text",
    "is_primary" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."vendor_bank_accounts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vendor_contacts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "vendor_id" "uuid" NOT NULL,
    "contact_name" "text" NOT NULL,
    "contact_number" "text" NOT NULL,
    "email" "text",
    "designation" "text",
    "is_primary" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."vendor_contacts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vendor_document_rules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "document_type" "text" NOT NULL,
    "label" "text" NOT NULL,
    "is_required" boolean DEFAULT false NOT NULL,
    "allow_multiple" boolean DEFAULT false NOT NULL,
    "allowed_file_types" "text"[] DEFAULT ARRAY['pdf'::"text", 'jpg'::"text", 'jpeg'::"text", 'png'::"text"] NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."vendor_document_rules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vendor_documents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "vendor_id" "uuid" NOT NULL,
    "document_type" "text" NOT NULL,
    "file_name" "text",
    "file_url" "text",
    "uploaded_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "document_number" "text",
    "expiry_date" "date",
    "remarks" "text",
    "is_verified" boolean DEFAULT false,
    "verified_at" timestamp with time zone,
    CONSTRAINT "vendor_documents_document_type_check" CHECK (("document_type" = ANY (ARRAY['PAN'::"text", 'GST_CERTIFICATE'::"text", 'AADHAAR_CIN'::"text", 'BANK_PROOF'::"text", 'MSME_CERTIFICATE'::"text", 'PAN_AADHAAR_ATTACHMENT'::"text", 'ADDITIONAL_DOCUMENT'::"text"])))
);


ALTER TABLE "public"."vendor_documents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vendor_gstins" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "vendor_id" "uuid" NOT NULL,
    "gstin" "text" NOT NULL,
    "state_code" "text",
    "state_name" "text",
    "is_primary" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."vendor_gstins" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vendor_msme_details" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "vendor_id" "uuid" NOT NULL,
    "is_registered" boolean DEFAULT false NOT NULL,
    "msme_number" "text",
    "msme_type" "text",
    "certificate_expiry_date" "date",
    "certificate_document_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."vendor_msme_details" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vendors" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "vendor_name" "text" NOT NULL,
    "vendor_type" "text" NOT NULL,
    "pan" "text",
    "gstin" "text",
    "aadhaar_cin" "text",
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "pan_aadhaar_link_status" "text" DEFAULT 'Yet to check'::"text" NOT NULL,
    "contractor_type" "text",
    "msme_registered" boolean DEFAULT false,
    "msme_number" "text",
    "msme_category" "text",
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "is_deleted" boolean DEFAULT false
);


ALTER TABLE "public"."vendors" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."work_order_documents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "work_order_id" "uuid" NOT NULL,
    "file_name" "text" NOT NULL,
    "file_url" "text" NOT NULL,
    "file_path" "text" NOT NULL,
    "uploaded_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."work_order_documents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."work_order_vendors" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "work_order_id" "uuid" NOT NULL,
    "vendor_id" "uuid" NOT NULL,
    "vendor_role" "text" NOT NULL,
    "is_primary" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."work_order_vendors" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."work_orders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "company_id" "uuid" NOT NULL,
    "site_id" "uuid" NOT NULL,
    "wo_number" "text" NOT NULL,
    "wo_date" "date",
    "wo_type" "text",
    "description" "text",
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "wo_value" numeric(18,2) DEFAULT 0,
    "start_date" "date",
    "end_date" "date",
    "retention_percent" numeric(5,2) DEFAULT 0,
    "security_percent" numeric(5,2) DEFAULT 0,
    "gst_percent" numeric(5,2) DEFAULT 18,
    "approval_status" "text" DEFAULT 'draft'::"text",
    "department" "text",
    "cost_code" "text",
    "created_by_name" "text",
    "created_by_email" "text",
    "created_at_user" timestamp with time zone,
    "approved_by_name" "text",
    "approved_by_email" "text",
    "approved_at" timestamp with time zone,
    "suspended_by_name" "text",
    "suspended_by_email" "text",
    "suspended_at" timestamp with time zone,
    "is_deleted" boolean DEFAULT false
);


ALTER TABLE "public"."work_orders" OWNER TO "postgres";


ALTER TABLE ONLY "public"."approvals"
    ADD CONSTRAINT "approvals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."companies"
    ADD CONSTRAINT "companies_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."company_bank_accounts"
    ADD CONSTRAINT "company_bank_accounts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."debit_note_documents"
    ADD CONSTRAINT "debit_note_documents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."debit_notes"
    ADD CONSTRAINT "debit_notes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."erp_module_groups"
    ADD CONSTRAINT "erp_module_groups_module_code_key" UNIQUE ("module_code");



ALTER TABLE ONLY "public"."erp_module_groups"
    ADD CONSTRAINT "erp_module_groups_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."erp_modules"
    ADD CONSTRAINT "erp_modules_module_code_key" UNIQUE ("module_code");



ALTER TABLE ONLY "public"."erp_modules"
    ADD CONSTRAINT "erp_modules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invoice_documents"
    ADD CONSTRAINT "invoice_documents_invoice_id_key" UNIQUE ("invoice_id");



ALTER TABLE ONLY "public"."invoice_documents"
    ADD CONSTRAINT "invoice_documents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."organization_modules"
    ADD CONSTRAINT "organization_modules_organization_id_module_code_key" UNIQUE ("organization_id", "module_code");



ALTER TABLE ONLY "public"."organization_modules"
    ADD CONSTRAINT "organization_modules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payment_documents"
    ADD CONSTRAINT "payment_documents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ra_bill_documents"
    ADD CONSTRAINT "ra_bill_documents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ra_bills"
    ADD CONSTRAINT "ra_bills_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."role_permissions"
    ADD CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."roles"
    ADD CONSTRAINT "roles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."roles"
    ADD CONSTRAINT "roles_role_code_key" UNIQUE ("role_code");



ALTER TABLE ONLY "public"."sites"
    ADD CONSTRAINT "sites_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_access_assignments"
    ADD CONSTRAINT "user_access_assignments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_permission_overrides"
    ADD CONSTRAINT "user_permission_overrides_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_permissions"
    ADD CONSTRAINT "user_permissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_permissions"
    ADD CONSTRAINT "user_permissions_user_id_module_code_action_code_key" UNIQUE ("user_id", "module_code", "action_code");



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vendor_bank_accounts"
    ADD CONSTRAINT "vendor_bank_accounts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vendor_contacts"
    ADD CONSTRAINT "vendor_contacts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vendor_document_rules"
    ADD CONSTRAINT "vendor_document_rules_organization_id_document_type_key" UNIQUE ("organization_id", "document_type");



ALTER TABLE ONLY "public"."vendor_document_rules"
    ADD CONSTRAINT "vendor_document_rules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vendor_documents"
    ADD CONSTRAINT "vendor_documents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vendor_gstins"
    ADD CONSTRAINT "vendor_gstins_organization_id_gstin_key" UNIQUE ("organization_id", "gstin");



ALTER TABLE ONLY "public"."vendor_gstins"
    ADD CONSTRAINT "vendor_gstins_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vendor_msme_details"
    ADD CONSTRAINT "vendor_msme_details_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vendors"
    ADD CONSTRAINT "vendors_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."work_order_documents"
    ADD CONSTRAINT "work_order_documents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."work_order_vendors"
    ADD CONSTRAINT "work_order_vendors_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."work_order_vendors"
    ADD CONSTRAINT "work_order_vendors_work_order_id_vendor_id_vendor_role_key" UNIQUE ("work_order_id", "vendor_id", "vendor_role");



ALTER TABLE ONLY "public"."work_orders"
    ADD CONSTRAINT "work_orders_organization_id_wo_number_key" UNIQUE ("organization_id", "wo_number");



ALTER TABLE ONLY "public"."work_orders"
    ADD CONSTRAINT "work_orders_pkey" PRIMARY KEY ("id");



CREATE INDEX "approvals_related_idx" ON "public"."approvals" USING "btree" ("related_table", "related_id");



CREATE INDEX "approvals_status_idx" ON "public"."approvals" USING "btree" ("organization_id", "approval_type", "status");



CREATE INDEX "idx_debit_notes_approval_status" ON "public"."debit_notes" USING "btree" ("approval_status");



CREATE INDEX "idx_debit_notes_approval_status_dashboard" ON "public"."debit_notes" USING "btree" ("approval_status");



CREATE INDEX "idx_debit_notes_status_approval" ON "public"."debit_notes" USING "btree" ("approval_status");



CREATE INDEX "idx_debit_notes_vendor_id" ON "public"."debit_notes" USING "btree" ("vendor_id");



CREATE INDEX "idx_debit_notes_work_order_id" ON "public"."debit_notes" USING "btree" ("work_order_id");



CREATE INDEX "idx_invoices_itc_status" ON "public"."invoices" USING "btree" ("itc_status");



CREATE INDEX "idx_invoices_vendor_id" ON "public"."invoices" USING "btree" ("vendor_id");



CREATE INDEX "idx_invoices_work_order_id" ON "public"."invoices" USING "btree" ("work_order_id");



CREATE INDEX "idx_payments_company_id" ON "public"."payments" USING "btree" ("company_id");



CREATE INDEX "idx_payments_vendor_id" ON "public"."payments" USING "btree" ("vendor_id");



CREATE INDEX "idx_payments_work_order_id" ON "public"."payments" USING "btree" ("work_order_id");



CREATE INDEX "idx_ra_bills_approval_status" ON "public"."ra_bills" USING "btree" ("approval_status");



CREATE INDEX "idx_ra_bills_approval_status_dashboard" ON "public"."ra_bills" USING "btree" ("approval_status");



CREATE INDEX "idx_ra_bills_status_approval" ON "public"."ra_bills" USING "btree" ("approval_status");



CREATE INDEX "idx_ra_bills_vendor_id" ON "public"."ra_bills" USING "btree" ("vendor_id");



CREATE INDEX "idx_ra_bills_work_order_id" ON "public"."ra_bills" USING "btree" ("work_order_id");



CREATE INDEX "idx_user_access_assignments_user_id" ON "public"."user_access_assignments" USING "btree" ("user_id");



CREATE INDEX "idx_user_permissions_user_id" ON "public"."user_permissions" USING "btree" ("user_id");



CREATE INDEX "idx_user_roles_user_id" ON "public"."user_roles" USING "btree" ("user_id");



CREATE INDEX "idx_vendors_pan_aadhaar_link_status" ON "public"."vendors" USING "btree" ("pan_aadhaar_link_status");



CREATE INDEX "idx_vendors_status" ON "public"."vendors" USING "btree" ("status");



CREATE INDEX "idx_work_order_vendors_vendor_id" ON "public"."work_order_vendors" USING "btree" ("vendor_id");



CREATE INDEX "idx_work_order_vendors_work_order_id" ON "public"."work_order_vendors" USING "btree" ("work_order_id");



CREATE INDEX "idx_work_orders_approval_status" ON "public"."work_orders" USING "btree" ("approval_status");



CREATE INDEX "idx_work_orders_company_id" ON "public"."work_orders" USING "btree" ("company_id");



CREATE INDEX "idx_work_orders_site_id" ON "public"."work_orders" USING "btree" ("site_id");



CREATE INDEX "idx_work_orders_status" ON "public"."work_orders" USING "btree" ("status");



CREATE INDEX "idx_work_orders_status_approval" ON "public"."work_orders" USING "btree" ("status", "approval_status");



CREATE UNIQUE INDEX "user_access_assignments_unique" ON "public"."user_access_assignments" USING "btree" ("user_id", "company_id", "site_id");



CREATE OR REPLACE TRIGGER "vendors_set_updated_at" BEFORE UPDATE ON "public"."vendors" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



ALTER TABLE ONLY "public"."approvals"
    ADD CONSTRAINT "approvals_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."companies"
    ADD CONSTRAINT "companies_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invoice_documents"
    ADD CONSTRAINT "invoice_documents_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ra_bill_documents"
    ADD CONSTRAINT "ra_bill_documents_ra_bill_id_fkey" FOREIGN KEY ("ra_bill_id") REFERENCES "public"."ra_bills"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sites"
    ADD CONSTRAINT "sites_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sites"
    ADD CONSTRAINT "sites_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vendor_bank_accounts"
    ADD CONSTRAINT "vendor_bank_accounts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vendor_bank_accounts"
    ADD CONSTRAINT "vendor_bank_accounts_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vendor_contacts"
    ADD CONSTRAINT "vendor_contacts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vendor_contacts"
    ADD CONSTRAINT "vendor_contacts_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vendor_document_rules"
    ADD CONSTRAINT "vendor_document_rules_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vendor_documents"
    ADD CONSTRAINT "vendor_documents_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vendor_documents"
    ADD CONSTRAINT "vendor_documents_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vendor_gstins"
    ADD CONSTRAINT "vendor_gstins_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id");



ALTER TABLE ONLY "public"."vendor_gstins"
    ADD CONSTRAINT "vendor_gstins_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vendor_msme_details"
    ADD CONSTRAINT "vendor_msme_details_certificate_document_id_fkey" FOREIGN KEY ("certificate_document_id") REFERENCES "public"."vendor_documents"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."vendor_msme_details"
    ADD CONSTRAINT "vendor_msme_details_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vendor_msme_details"
    ADD CONSTRAINT "vendor_msme_details_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vendors"
    ADD CONSTRAINT "vendors_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."work_order_vendors"
    ADD CONSTRAINT "work_order_vendors_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."work_order_vendors"
    ADD CONSTRAINT "work_order_vendors_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."work_order_vendors"
    ADD CONSTRAINT "work_order_vendors_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."work_orders"
    ADD CONSTRAINT "work_orders_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."work_orders"
    ADD CONSTRAINT "work_orders_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."work_orders"
    ADD CONSTRAINT "work_orders_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE RESTRICT;



ALTER TABLE "public"."approvals" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."erp_module_groups" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."organization_modules" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payment_documents" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."vendor_document_rules" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."vendor_msme_details" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



GRANT ALL ON TABLE "public"."approvals" TO "anon";
GRANT ALL ON TABLE "public"."approvals" TO "authenticated";
GRANT ALL ON TABLE "public"."approvals" TO "service_role";



GRANT ALL ON TABLE "public"."companies" TO "anon";
GRANT ALL ON TABLE "public"."companies" TO "authenticated";
GRANT ALL ON TABLE "public"."companies" TO "service_role";



GRANT ALL ON TABLE "public"."company_bank_accounts" TO "anon";
GRANT ALL ON TABLE "public"."company_bank_accounts" TO "authenticated";
GRANT ALL ON TABLE "public"."company_bank_accounts" TO "service_role";



GRANT ALL ON TABLE "public"."debit_note_documents" TO "anon";
GRANT ALL ON TABLE "public"."debit_note_documents" TO "authenticated";
GRANT ALL ON TABLE "public"."debit_note_documents" TO "service_role";



GRANT ALL ON TABLE "public"."debit_notes" TO "anon";
GRANT ALL ON TABLE "public"."debit_notes" TO "authenticated";
GRANT ALL ON TABLE "public"."debit_notes" TO "service_role";



GRANT ALL ON TABLE "public"."erp_module_groups" TO "anon";
GRANT ALL ON TABLE "public"."erp_module_groups" TO "authenticated";
GRANT ALL ON TABLE "public"."erp_module_groups" TO "service_role";



GRANT ALL ON TABLE "public"."erp_modules" TO "anon";
GRANT ALL ON TABLE "public"."erp_modules" TO "authenticated";
GRANT ALL ON TABLE "public"."erp_modules" TO "service_role";



GRANT ALL ON TABLE "public"."invoice_documents" TO "anon";
GRANT ALL ON TABLE "public"."invoice_documents" TO "authenticated";
GRANT ALL ON TABLE "public"."invoice_documents" TO "service_role";



GRANT ALL ON TABLE "public"."invoices" TO "anon";
GRANT ALL ON TABLE "public"."invoices" TO "authenticated";
GRANT ALL ON TABLE "public"."invoices" TO "service_role";



GRANT ALL ON TABLE "public"."organization_modules" TO "anon";
GRANT ALL ON TABLE "public"."organization_modules" TO "authenticated";
GRANT ALL ON TABLE "public"."organization_modules" TO "service_role";



GRANT ALL ON TABLE "public"."organizations" TO "anon";
GRANT ALL ON TABLE "public"."organizations" TO "authenticated";
GRANT ALL ON TABLE "public"."organizations" TO "service_role";



GRANT ALL ON TABLE "public"."payment_documents" TO "anon";
GRANT ALL ON TABLE "public"."payment_documents" TO "authenticated";
GRANT ALL ON TABLE "public"."payment_documents" TO "service_role";



GRANT ALL ON TABLE "public"."payments" TO "anon";
GRANT ALL ON TABLE "public"."payments" TO "authenticated";
GRANT ALL ON TABLE "public"."payments" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."ra_bill_documents" TO "anon";
GRANT ALL ON TABLE "public"."ra_bill_documents" TO "authenticated";
GRANT ALL ON TABLE "public"."ra_bill_documents" TO "service_role";



GRANT ALL ON TABLE "public"."ra_bills" TO "anon";
GRANT ALL ON TABLE "public"."ra_bills" TO "authenticated";
GRANT ALL ON TABLE "public"."ra_bills" TO "service_role";



GRANT ALL ON TABLE "public"."role_permissions" TO "anon";
GRANT ALL ON TABLE "public"."role_permissions" TO "authenticated";
GRANT ALL ON TABLE "public"."role_permissions" TO "service_role";



GRANT ALL ON TABLE "public"."roles" TO "anon";
GRANT ALL ON TABLE "public"."roles" TO "authenticated";
GRANT ALL ON TABLE "public"."roles" TO "service_role";



GRANT ALL ON TABLE "public"."sites" TO "anon";
GRANT ALL ON TABLE "public"."sites" TO "authenticated";
GRANT ALL ON TABLE "public"."sites" TO "service_role";



GRANT ALL ON TABLE "public"."user_access_assignments" TO "anon";
GRANT ALL ON TABLE "public"."user_access_assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."user_access_assignments" TO "service_role";



GRANT ALL ON TABLE "public"."user_permission_overrides" TO "anon";
GRANT ALL ON TABLE "public"."user_permission_overrides" TO "authenticated";
GRANT ALL ON TABLE "public"."user_permission_overrides" TO "service_role";



GRANT ALL ON TABLE "public"."user_permissions" TO "anon";
GRANT ALL ON TABLE "public"."user_permissions" TO "authenticated";
GRANT ALL ON TABLE "public"."user_permissions" TO "service_role";



GRANT ALL ON TABLE "public"."user_roles" TO "anon";
GRANT ALL ON TABLE "public"."user_roles" TO "authenticated";
GRANT ALL ON TABLE "public"."user_roles" TO "service_role";



GRANT ALL ON TABLE "public"."vendor_bank_accounts" TO "anon";
GRANT ALL ON TABLE "public"."vendor_bank_accounts" TO "authenticated";
GRANT ALL ON TABLE "public"."vendor_bank_accounts" TO "service_role";



GRANT ALL ON TABLE "public"."vendor_contacts" TO "anon";
GRANT ALL ON TABLE "public"."vendor_contacts" TO "authenticated";
GRANT ALL ON TABLE "public"."vendor_contacts" TO "service_role";



GRANT ALL ON TABLE "public"."vendor_document_rules" TO "anon";
GRANT ALL ON TABLE "public"."vendor_document_rules" TO "authenticated";
GRANT ALL ON TABLE "public"."vendor_document_rules" TO "service_role";



GRANT ALL ON TABLE "public"."vendor_documents" TO "anon";
GRANT ALL ON TABLE "public"."vendor_documents" TO "authenticated";
GRANT ALL ON TABLE "public"."vendor_documents" TO "service_role";



GRANT ALL ON TABLE "public"."vendor_gstins" TO "anon";
GRANT ALL ON TABLE "public"."vendor_gstins" TO "authenticated";
GRANT ALL ON TABLE "public"."vendor_gstins" TO "service_role";



GRANT ALL ON TABLE "public"."vendor_msme_details" TO "anon";
GRANT ALL ON TABLE "public"."vendor_msme_details" TO "authenticated";
GRANT ALL ON TABLE "public"."vendor_msme_details" TO "service_role";



GRANT ALL ON TABLE "public"."vendors" TO "anon";
GRANT ALL ON TABLE "public"."vendors" TO "authenticated";
GRANT ALL ON TABLE "public"."vendors" TO "service_role";



GRANT ALL ON TABLE "public"."work_order_documents" TO "anon";
GRANT ALL ON TABLE "public"."work_order_documents" TO "authenticated";
GRANT ALL ON TABLE "public"."work_order_documents" TO "service_role";



GRANT ALL ON TABLE "public"."work_order_vendors" TO "anon";
GRANT ALL ON TABLE "public"."work_order_vendors" TO "authenticated";
GRANT ALL ON TABLE "public"."work_order_vendors" TO "service_role";



GRANT ALL ON TABLE "public"."work_orders" TO "anon";
GRANT ALL ON TABLE "public"."work_orders" TO "authenticated";
GRANT ALL ON TABLE "public"."work_orders" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







