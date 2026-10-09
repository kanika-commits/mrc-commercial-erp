import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requirePermission } from "@/lib/serverPermissions";
import { renderPilotRevisionPdf } from "@/lib/workOrderPilotRevisionPdf.server";
import { isRevisionSchemaUnavailable } from "@/lib/workOrderPilotRevisions.server";

export async function POST(request: Request, { params }: { params: Promise<{ id: string; revisionId: string }> }) {
  try {
    const auth = await requirePermission(request, "work_orders", "view");
    if ("response" in auth) return auth.response;
    const { id, revisionId } = await params;
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data: revision, error } = await admin.from("work_order_pilot_revisions").select("*, work_orders!inner(creation_request_id,organization_id,company_id,site_id,wo_number,wo_date,created_by,created_by_name,created_by_email,created_at,work_order_key_terms,standard_terms_snapshot,total_basic_amount,total_gst_amount,total_amount,delivery_snapshot,company:companies(company_name),site:sites(site_name),letterhead_snapshot)").eq("id", revisionId).eq("work_order_id", id).maybeSingle();
    if (error) throw error;
    if (!revision || !revision.work_orders?.creation_request_id) return NextResponse.json({ error: "Pilot revision not found." }, { status: 404 });
    let bytes: Uint8Array;
    if (revision.status !== "draft") {
      const { data: artifact, error: artifactError } = await admin.from("work_order_pilot_revision_artifacts").select("storage_bucket,storage_path").eq("revision_id", revisionId).maybeSingle();
      if (artifactError) throw artifactError;
      if (!artifact) return NextResponse.json({ error: "The submitted Pilot revision PDF artifact is missing." }, { status: 409 });
      const stored = await admin.storage.from(artifact.storage_bucket).download(artifact.storage_path);
      if (stored.error || !stored.data) return NextResponse.json({ error: "The submitted Pilot revision PDF artifact could not be loaded." }, { status: 409 });
      bytes = new Uint8Array(await stored.data.arrayBuffer());
    } else {
      const [{ data: predecessor }, { data: vendorLink, error: vendorLinkError }, { data: canonicalItems, error: canonicalItemsError }] = await Promise.all([
        revision.predecessor_revision_id ? admin.from("work_order_pilot_revisions").select("snapshot").eq("id", revision.predecessor_revision_id).maybeSingle() : Promise.resolve({ data: null }),
        admin.from("work_order_vendors").select("vendor_id,vendor_role").eq("work_order_id", id).eq("is_primary", true).maybeSingle(),
        admin.from("work_order_items").select("*").eq("work_order_id", id).order("sort_order"),
      ]);
      if (vendorLinkError) throw vendorLinkError;
      if (canonicalItemsError) throw canonicalItemsError;
      let vendor_snapshot = revision.snapshot?.fields?.vendor_snapshot || null;
      if (!vendor_snapshot && vendorLink?.vendor_id) {
        const [{ data: vendor, error: vendorError }, { data: contact, error: contactError }] = await Promise.all([
          admin.from("vendors").select("*").eq("id", vendorLink.vendor_id).maybeSingle(),
          admin.from("vendor_contacts").select("contact_name,contact_number,email").eq("vendor_id", vendorLink.vendor_id).order("created_at", { ascending: true }).limit(1).maybeSingle(),
        ]);
        if (vendorError) throw vendorError;
        if (contactError) throw contactError;
        vendor_snapshot = vendor ? { vendor_name: vendor.vendor_name || vendor.name || vendor.company_name, address: vendor.address, pan: vendor.pan, contact_person: vendor.contact_person || vendor.contact_name || contact?.contact_name, phone: vendor.phone || vendor.mobile || contact?.contact_number, email: vendor.email || contact?.email, gstin: vendor.gstin || vendor.gst_number } : null;
      }
      const baseline = predecessor || { snapshot: { fields: { work_order_key_terms: revision.work_orders.work_order_key_terms, standard_terms_snapshot: revision.work_orders.standard_terms_snapshot }, totals: { total_basic_amount: revision.work_orders.total_basic_amount, total_gst_amount: revision.work_orders.total_gst_amount, total_amount: revision.work_orders.total_amount }, items: canonicalItems || [] } };
      const revisionFields = revision.snapshot?.fields || {};
      const revisionDeliverySnapshot = revisionFields.delivery_snapshot || {};
      const canonicalDeliverySnapshot = revision.work_orders.delivery_snapshot || {};
      const selection = {
        ...(canonicalDeliverySnapshot.master_selection || {}),
        ...(revisionDeliverySnapshot.master_selection || {}),
        ...(revisionFields.master_selection || {}),
        gst_registration_id: revisionFields.gst_registration_id || revisionDeliverySnapshot.master_selection?.gst_registration_id || canonicalDeliverySnapshot.master_selection?.gst_registration_id,
        billing_address_id: revisionFields.billing_address_id || revisionDeliverySnapshot.master_selection?.billing_address_id || canonicalDeliverySnapshot.master_selection?.billing_address_id,
        delivery_location_id: revisionFields.delivery_location_id || revisionDeliverySnapshot.master_selection?.delivery_location_id || canonicalDeliverySnapshot.master_selection?.delivery_location_id,
        billing_contact_id: revisionFields.billing_contact_id || revisionFields.contact_selection?.billing_contact_id || revisionDeliverySnapshot.master_selection?.billing_contact_id || canonicalDeliverySnapshot.master_selection?.billing_contact_id,
        delivery_contact_id: revisionFields.delivery_contact_id || revisionFields.contact_selection?.delivery_contact_id || revisionDeliverySnapshot.master_selection?.delivery_contact_id || canonicalDeliverySnapshot.master_selection?.delivery_contact_id,
      };
      const deliverySnapshot = {
        ...canonicalDeliverySnapshot,
        ...revisionDeliverySnapshot,
        gst_billing: canonicalDeliverySnapshot.gst_billing || undefined,
        billing_address: canonicalDeliverySnapshot.billing_address || undefined,
        delivery_location: canonicalDeliverySnapshot.delivery_location || undefined,
        billing_contact: canonicalDeliverySnapshot.billing_contact || undefined,
        delivery_contact: canonicalDeliverySnapshot.delivery_contact || undefined,
      };
      if (selection.gst_registration_id || selection.billing_address_id || selection.delivery_location_id || selection.billing_contact_id || selection.delivery_contact_id) {
        const [{ data: gstBilling, error: gstError }, { data: billingAddress, error: billingError }, { data: deliveryLocation, error: deliveryError }, { data: siteContacts, error: contactsError }] = await Promise.all([
          selection.gst_registration_id
            ? admin.from("company_gst_registrations").select("id,organization_id,company_id,gstin,legal_name,trade_name,state,state_code,registration_type").eq("id", selection.gst_registration_id).eq("organization_id", revision.work_orders.organization_id).eq("company_id", revision.work_orders.company_id).eq("status", "active").maybeSingle()
            : Promise.resolve({ data: null, error: null }),
          selection.billing_address_id
            ? admin.from("company_billing_addresses").select("id,organization_id,company_id,gst_registration_id,label,address_line1,address_line2,city,state,pincode,gstin,contact_name,mobile,email").eq("id", selection.billing_address_id).eq("organization_id", revision.work_orders.organization_id).eq("company_id", revision.work_orders.company_id).eq("status", "active").maybeSingle()
            : Promise.resolve({ data: null, error: null }),
          selection.delivery_location_id
            ? admin.from("site_delivery_locations").select("id,organization_id,company_id,site_id,billing_address_id,billing_address:company_billing_addresses!inner(id,gst_registration_id),location_name,address,address_line1,address_line2,city,state,pincode,gstin,contact_name,mobile,email").eq("id", selection.delivery_location_id).eq("organization_id", revision.work_orders.organization_id).eq("company_id", revision.work_orders.company_id).eq("site_id", revision.work_orders.site_id).eq("status", "active").maybeSingle()
            : Promise.resolve({ data: null, error: null }),
          admin.from("site_contacts").select("id,organization_id,site_id,contact_name,designation,mobile,email,contact_type").in("id", [selection.billing_contact_id, selection.delivery_contact_id].filter(Boolean)).eq("organization_id", revision.work_orders.organization_id).eq("site_id", revision.work_orders.site_id).eq("status", "active"),
        ]);
        if (gstError || billingError || deliveryError || contactsError) throw gstError || billingError || deliveryError || contactsError;
        const contacts = siteContacts || [];
        const resolvedBillingContact = contacts.find((contact: any) => contact.id === selection.billing_contact_id);
        const resolvedDeliveryContact = contacts.find((contact: any) => contact.id === selection.delivery_contact_id);
        if (selection.gst_registration_id && !gstBilling) return NextResponse.json({ error: "Selected GST/Billing Master is missing, inactive, or outside the Work Order scope." }, { status: 400 });
        if (selection.billing_address_id && !billingAddress) return NextResponse.json({ error: "Selected Billing Address is missing, inactive, or outside the Work Order scope." }, { status: 400 });
        if (selection.delivery_location_id && !deliveryLocation) return NextResponse.json({ error: "Selected Delivery Location is missing, inactive, or outside the Work Order scope." }, { status: 400 });
        if (selection.billing_contact_id && !resolvedBillingContact) return NextResponse.json({ error: "Selected Billing Contact is missing, inactive, or outside the Work Order scope." }, { status: 400 });
        if (selection.delivery_contact_id && !resolvedDeliveryContact) return NextResponse.json({ error: "Selected Delivery Contact is missing, inactive, or outside the Work Order scope." }, { status: 400 });
        if (gstBilling) deliverySnapshot.gst_billing = gstBilling;
        if (billingAddress) deliverySnapshot.billing_address = billingAddress;
        if (deliveryLocation) deliverySnapshot.delivery_location = deliveryLocation;
        if (resolvedBillingContact) deliverySnapshot.billing_contact = resolvedBillingContact;
        if (resolvedDeliveryContact) deliverySnapshot.delivery_contact = resolvedDeliveryContact;
      }
      const { data: creatorProfile, error: creatorProfileError } = revision.created_by
        ? await admin.from("profiles").select("id,full_name,email").eq("id", revision.created_by).maybeSingle()
        : { data: null, error: null };
      if (creatorProfileError) throw creatorProfileError;
      bytes = await renderPilotRevisionPdf(revision, baseline, {
        company_name: revision.work_orders.company?.company_name,
        site_name: revision.work_orders.site?.site_name,
        original_wo_date: revision.work_orders.wo_date,
        created_by: revision.created_by,
        created_by_name: creatorProfile?.full_name || revision.created_by_name,
        created_by_email: creatorProfile?.email || revision.created_by_email,
        created_at: revision.created_at,
        vendor_snapshot,
        billing_snapshot: deliverySnapshot.billing_address,
        delivery_snapshot: deliverySnapshot,
        letterhead_snapshot: revision.work_orders.letterhead_snapshot,
      });
    }
    return new NextResponse(Buffer.from(bytes), { headers: { "Content-Type": "application/pdf", "Content-Length": String(bytes.length), "Content-Disposition": `inline; filename=work-order-revision-${revision.revision_number}.pdf` } });
  } catch (e: any) {
    if (isRevisionSchemaUnavailable(e)) return NextResponse.json({ error: "Pilot Work Order revisions are not available because the revision schema has not been installed in this database." }, { status: 503 });
    return NextResponse.json({ error: e.message || "Could not render revision PDF." }, { status: 500 });
  }
}
