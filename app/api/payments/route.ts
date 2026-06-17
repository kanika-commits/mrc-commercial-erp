import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function adminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  if (!serviceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");
  }

  return createClient(supabaseUrl, serviceRoleKey);
}

async function requireUser(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const token = request.headers.get("authorization")?.replace("Bearer ", "");

  if (!token) {
    return { error: "Missing auth token.", status: 401 };
  }

  const authClient = createClient(supabaseUrl, anonKey);
  const {
    data: { user },
    error,
  } = await authClient.auth.getUser(token);

  if (error) throw error;

  if (!user) {
    return { error: "User not found.", status: 401 };
  }

  return { user };
}

function roundAmount(value: FormDataEntryValue | null) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? Math.round(amount) : 0;
}

function isBankTransferMode(mode: string) {
  return ["bank transfer", "neft", "rtgs", "imps", "upi"].includes(
    mode.trim().toLowerCase()
  );
}

export async function POST(request: Request) {
  try {
    const auth = await requireUser(request);

    if ("error" in auth) {
      return NextResponse.json(
        { error: auth.error },
        { status: auth.status }
      );
    }

    const formData = await request.formData();
    const invoiceId = String(formData.get("invoice_id") || "").trim();
    const paymentDate = String(formData.get("payment_date") || "").trim();
    const paymentMode = String(formData.get("payment_mode") || "").trim();
    const companyBankAccountId = String(
      formData.get("company_bank_account_id") || ""
    ).trim();
    const totalPayment = roundAmount(formData.get("total_payment"));
    const tdsAmount = roundAmount(formData.get("tds_amount"));
    const transferredAmount = roundAmount(formData.get("transferred_amount"));
    const referenceNumber = String(
      formData.get("reference_number") || formData.get("utr_number") || ""
    ).trim();
    const remarks = String(formData.get("remarks") || "").trim();

    if (!invoiceId) {
      return NextResponse.json(
        { error: "Invoice is required." },
        { status: 400 }
      );
    }

    if (!paymentDate) {
      return NextResponse.json(
        { error: "Payment Date is required." },
        { status: 400 }
      );
    }

    if (!paymentMode) {
      return NextResponse.json(
        { error: "Payment Mode is required." },
        { status: 400 }
      );
    }

    if (totalPayment <= 0) {
      return NextResponse.json(
        { error: "Payment amount is required." },
        { status: 400 }
      );
    }

    if (tdsAmount < 0 || tdsAmount > totalPayment) {
      return NextResponse.json(
        { error: "TDS cannot exceed Total Payment." },
        { status: 400 }
      );
    }

    if (transferredAmount !== totalPayment - tdsAmount) {
      return NextResponse.json(
        { error: "Transferred Amount must equal Total Payment minus TDS." },
        { status: 400 }
      );
    }

    if (isBankTransferMode(paymentMode) && !referenceNumber) {
      return NextResponse.json(
        { error: "UTR / Reference Number is required for bank transfers." },
        { status: 400 }
      );
    }

    const admin = adminClient();

    const { data: invoice, error: invoiceError } = await admin
      .from("invoices")
      .select(
        `
          id,
          organization_id,
          work_order_id,
          vendor_id,
          invoice_number,
          invoice_amount,
          itc_status
        `
      )
      .eq("id", invoiceId)
      .maybeSingle();

    if (invoiceError) throw invoiceError;

    if (!invoice) {
      return NextResponse.json(
        { error: "Selected invoice was not found." },
        { status: 404 }
      );
    }

    if (String(invoice.itc_status || "").toLowerCase() !== "claimed") {
      return NextResponse.json(
        { error: "Only invoices with ITC status Claimed can be paid." },
        { status: 400 }
      );
    }

    const { data: workOrder, error: workOrderError } = invoice.work_order_id
      ? await admin
          .from("work_orders")
          .select("id, company_id")
          .eq("id", invoice.work_order_id)
          .maybeSingle()
      : { data: null, error: null };

    if (workOrderError) throw workOrderError;

    const { data: previousPayments, error: paymentsError } = await admin
      .from("payments")
      .select("total_payment, payment_amount")
      .eq("invoice_id", invoiceId)
      .eq("is_deleted", false);

    if (paymentsError) throw paymentsError;

    const previousTotal = (previousPayments || []).reduce(
      (sum, payment) =>
        sum + Number(payment.total_payment || payment.payment_amount || 0),
      0
    );
    const invoiceAmount = Number(invoice.invoice_amount || 0);
    const balance = Math.max(invoiceAmount - previousTotal, 0);

    if (totalPayment > balance) {
      return NextResponse.json(
        {
          error: `Payment exceeds invoice balance. Balance payable is ${balance}.`,
        },
        { status: 400 }
      );
    }

    const userEmail = auth.user.email || "platform.owner@mrc.local";
    const userName =
      auth.user.user_metadata?.full_name ||
      auth.user.user_metadata?.name ||
      userEmail ||
      "Platform Owner";

    const paymentNumber = `PAY/${Date.now()}`;

    const { data: payment, error: paymentError } = await admin
      .from("payments")
      .insert({
        organization_id: invoice.organization_id,
        company_id: workOrder?.company_id || null,
        work_order_id: invoice.work_order_id,
        vendor_id: invoice.vendor_id,
        invoice_id: invoice.id,
        payment_number: paymentNumber,
        payment_date: paymentDate,
        payment_type: "Invoice",
        reference_number: referenceNumber || null,
        utr_number: referenceNumber || null,
        company_bank_account_id: companyBankAccountId || null,
        total_payment: totalPayment,
        tds_amount: tdsAmount,
        transferred_amount: transferredAmount,
        payment_amount: transferredAmount,
        payment_mode: paymentMode,
        status: "Completed",
        remarks: remarks || null,
        created_by_name: userName,
        created_by_email: userEmail,
        created_at_user: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (paymentError) throw paymentError;

    return NextResponse.json({ id: payment.id });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to create payment." },
      { status: 500 }
    );
  }
}
