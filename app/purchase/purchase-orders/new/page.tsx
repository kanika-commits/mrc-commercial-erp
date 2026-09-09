"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch, getAccessToken } from "@/components/hr/hrClient";
import { useAccessContext } from "@/components/AccessContext";
import { can } from "@/lib/accessControl";
import { VendorCreateForm } from "@/app/vendors/new/page";
import { parsePurchaseOrderStandardTerms } from "@/lib/procurement/standardTerms";

type Source = "direct" | "indent";
type Item = { item_id?: string; item_name: string; item_code?: string; description?: string; specification?: string; make?: string; quantity: string; uom?: string; unit_rate: string; gst_rate: string; source_requisition_line_key?: string };
type AttachmentDraft = { file: File; documentType: string };
type AdditionalCharge = { name: string; amount: string };

const today = () => new Date().toISOString().slice(0, 10);
const money = (value: number) => `₹ ${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const sourceLabels: Record<Source, string> = { direct: "Direct Purchase", indent: "From Material Indent" };

function getCreatedId(value: any): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return getCreatedId(value[0]);
  return value.id || value.purchase_order_id || value.purchase_order?.id || value.purchase_orders?.[0]?.id || value.result?.id || value.result?.purchase_order_id || null;
}

function fileSize(value: number) {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export default function NewPurchaseOrderPage() {
  const { access } = useAccessContext();
  const router = useRouter();
  const params = useSearchParams();
  const initialSource = (params.get("source") as Source) || "direct";
  const editId = params.get("edit_id");
  const [source, setSource] = useState<Source>(["direct", "indent"].includes(initialSource) ? initialSource : "direct");
  const [lookups, setLookups] = useState<any>({ companies: [], sites: [], vendors: [], items: [], indents: [], delivery_locations: [], site_contacts: [], gst_billing_masters: [], letterheads: [] });
  const [companyId, setCompanyId] = useState(params.get("company_id") || "");
  const [siteId, setSiteId] = useState(params.get("site_id") || "");
  const [vendorId, setVendorId] = useState("");
  const [poDate, setPoDate] = useState(today());
  const [indentLineKey, setIndentLineKey] = useState(params.get("line_key") || "");
  const [selectedIndentId, setSelectedIndentId] = useState(params.get("requisition_id") || "");
  const [items, setItems] = useState<Item[]>([{ item_name: "", quantity: "", unit_rate: "", gst_rate: "0" }]);
  const [delivery, setDelivery] = useState({ location: "", address: "", expected_date: "" });
  const [commercial, setCommercial] = useState({ payment_terms: "", delivery_terms: "" });
  const [standardTerms, setStandardTerms] = useState("");
  const [termsTemplateId, setTermsTemplateId] = useState("");
  const [billingContactId, setBillingContactId] = useState("");
  const [deliveryContactId, setDeliveryContactId] = useState("");
  const [deliveryLocationId, setDeliveryLocationId] = useState("");
  const [additionalCharges, setAdditionalCharges] = useState<AdditionalCharge[]>([]);
  const [keyTerms, setKeyTerms] = useState([{ description: "Price Validity", terms: "" }, { description: "Freight", terms: "" }, { description: "Delivery Timeline", terms: "" }, { description: "Payment Terms", terms: "" }]);
  const [message, setMessage] = useState("");
  const errorRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [customDelivery, setCustomDelivery] = useState(false);
  const [materialOpenIndex, setMaterialOpenIndex] = useState<number | null>(null);
  const [materialMenuPosition, setMaterialMenuPosition] = useState<{ index: number; left: number; top: number; width: number } | null>(null);
  const materialInputRefs = useRef<Record<number, HTMLInputElement | null>>({});
  const [vendorModalOpen, setVendorModalOpen] = useState(false);
  const [vendorFeedback, setVendorFeedback] = useState<any>(null);
  const [vendorCompletion, setVendorCompletion] = useState({ address: "", gstin: "", phone: "", email: "", contact_name: "" });
  const [vendorCompletionSaving, setVendorCompletionSaving] = useState(false);
  const [attachments, setAttachments] = useState<AttachmentDraft[]>([]);
  const [existingDocuments, setExistingDocuments] = useState<any[]>([]);
  const [removingDocumentId, setRemovingDocumentId] = useState<string | null>(null);
  const [editablePoStatus, setEditablePoStatus] = useState<string | null>(null);
  const [createdPoId, setCreatedPoId] = useState<string | null>(null);
  const [creationRequestId] = useState(() => crypto.randomUUID());
  const previousCompanyIdRef = useRef(companyId);

  const canAddVendors = can(access?.permissions || [], "vendors", "add");
  const canEditVendors = can(access?.permissions || [], "vendors", "edit");
  const handleVendorCreated = (createdVendorId: string) => {
    setVendorModalOpen(false);
    apiFetch("/api/procurement/purchase-orders/lookups").then((nextLookups) => {
      setLookups(nextLookups);
      setVendorId(createdVendorId);
    }).catch((error) => setMessage(error.message || "Vendor was created, but the Vendor list could not be refreshed."));
  };

  useEffect(() => {
    apiFetch("/api/procurement/purchase-orders/lookups")
      .then(setLookups)
      .catch((error) => setMessage(error.message || "Failed to load Purchase Order options."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!editId) return;
    Promise.all([apiFetch(`/api/procurement/purchase-orders/${editId}`), apiFetch(`/api/procurement/purchase-orders/${editId}/documents`)]).then(([result, documentResult]) => {
      const po = result.purchase_order;
      if (po.status !== "draft" && po.status !== "sent_back") throw new Error("Only editable Draft Purchase Orders can be opened here.");
      setEditablePoStatus(po.status);
      const nextSource = ["direct", "indent"].includes(po.source_type) ? po.source_type as Source : "direct";
      setSource(nextSource);
      setCompanyId(po.company_id || ""); setSiteId(po.site_id || ""); setVendorId(po.vendor_id || ""); setPoDate(po.po_date || today());
      setDelivery(po.delivery_snapshot || {}); setCommercial(po.commercial_snapshot || {});
      setDeliveryLocationId(po.delivery_snapshot?.master_selection?.delivery_location_id || po.delivery_snapshot?.delivery_location_id || "");
      setBillingContactId(po.delivery_snapshot?.master_selection?.billing_contact_id || po.delivery_snapshot?.billing_contact?.site_contact_id || po.delivery_snapshot?.master_selection?.site_contact_id || "");
      setDeliveryContactId(po.delivery_snapshot?.master_selection?.delivery_contact_id || po.delivery_snapshot?.delivery_contact?.site_contact_id || po.delivery_snapshot?.master_selection?.site_contact_id || po.delivery_snapshot?.site_contact_id || "");
      setAdditionalCharges(Array.isArray(po.commercial_snapshot?.additional_charges) ? po.commercial_snapshot.additional_charges.map((charge: any) => ({ name: String(charge.name || ""), amount: String(charge.amount ?? "") })) : []);
      setKeyTerms(Array.isArray(po.commercial_snapshot?.key_terms) && po.commercial_snapshot.key_terms.length ? po.commercial_snapshot.key_terms : [{ description: "Price Validity", terms: "" }, { description: "Freight", terms: "" }, { description: "Delivery Timeline", terms: "" }, { description: "Payment Terms", terms: "" }]);
      const parsedTerms = parsePurchaseOrderStandardTerms(po.standard_terms_snapshot);
      setStandardTerms(parsedTerms?.kind === "structured" ? parsedTerms.clauses.map((clause) => `${clause.heading}\n${clause.clause_body}`).join("\n\n") : parsedTerms?.text || "");
      setItems((po.items || []).map((item: any) => ({ item_id: item.item_id, item_name: item.item_name_snapshot || "", item_code: item.item_code_snapshot, description: item.description_snapshot || item.specification_snapshot || "", specification: item.specification_snapshot, make: item.make_snapshot || "", quantity: String(item.quantity ?? ""), uom: item.uom_snapshot || "", unit_rate: String(item.unit_rate ?? ""), gst_rate: String(item.gst_rate ?? "0"), source_requisition_line_key: item.source_requisition_line_key })));
      setExistingDocuments(documentResult.documents || []);
      setLoading(false);
    }).catch((error) => { setMessage(error.message || "Failed to load the Draft Purchase Order."); setLoading(false); });
  }, [editId]);

  useEffect(() => {
    if (!message) return;
    errorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [message]);

  useEffect(() => {
    if (materialOpenIndex === null) return;
    const reposition = () => {
      const input = materialInputRefs.current[materialOpenIndex];
      if (!input) return;
      const rect = input.getBoundingClientRect();
      setMaterialMenuPosition({ index: materialOpenIndex, left: rect.left, top: rect.bottom + 4, width: Math.max(rect.width, 320) });
    };
    reposition();
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [materialOpenIndex]);

  const sites = useMemo(() => lookups.sites, [lookups.sites]);
  const selectedCompany = lookups.companies.find((company: any) => company.id === companyId);
  const selectedVendor = lookups.vendors.find((vendor: any) => vendor.id === vendorId);
  const selectedVendorContact = selectedVendor?.contact || null;
  const contractorType = String(selectedVendor?.contractor_type || "").trim().toLowerCase();
  const gstinRequired = ["company", "proprietorship", "proprietor"].includes(contractorType);
  const missingVendorFields = {
    address: !String(selectedVendor?.address || "").trim(),
    gstin: !String(selectedVendor?.primary_gstin || selectedVendor?.gstin || "").trim(),
    phone: !String(selectedVendorContact?.contact_number || "").trim(),
    email: !String(selectedVendorContact?.email || "").trim(),
  };
  const missingCompletableVendorFields = Object.values(missingVendorFields).some(Boolean);
  const gstBillingMasters = (lookups.gst_billing_masters || []).filter((row: any) => row.company_id === companyId).sort((a: any, b: any) => Number(b.is_default) - Number(a.is_default));
  const selectedGstBilling = gstBillingMasters.find((row: any) => row.is_default) || (gstBillingMasters.length === 1 ? gstBillingMasters[0] : null);
  const selectedBilling = selectedGstBilling?.billing_address || null;
  const selectedLetterhead = (lookups.letterheads || []).find((row: any) => row.company_id === companyId);
  const deliveryAddressFor = (row: any) => [row?.address_line1, row?.address_line2, row?.city, row?.state, row?.pincode].filter(Boolean).join(", ") || row?.address || "";
  const deliveryCompanyName = (row: any) => row?.company?.company_name || lookups.companies.find((company: any) => company.id === row?.company_id)?.company_name || "";
  const deliveryLocations = (lookups.delivery_locations || []).filter((row: any) => row.site_id === siteId && row.status === "active" && (!row.company_id || row.company_id === companyId)).sort((a: any, b: any) => Number(b.is_default) - Number(a.is_default) || String(a.location_name || "").localeCompare(String(b.location_name || "")));
  const defaultDeliveryLocation = deliveryLocations.find((row: any) => row.is_default) || (deliveryLocations.length === 1 ? deliveryLocations[0] : null);
  const selectedDeliveryLocation = deliveryLocations.find((row: any) => row.id === deliveryLocationId) || defaultDeliveryLocation;
  const siteContacts = (lookups.site_contacts || []).filter((row: any) => row.site_id === siteId && row.status === "active").sort((a: any, b: any) => Number(b.is_default) - Number(a.is_default) || String(a.contact_name || "").localeCompare(String(b.contact_name || "")));
  const defaultSiteContact = siteContacts.find((row: any) => row.is_default) || (siteContacts.length === 1 ? siteContacts[0] : null);
  const selectedDeliveryContact = siteContacts.find((row: any) => row.id === deliveryContactId) || defaultSiteContact;
  const selectedBillingContact = siteContacts.find((row: any) => row.id === billingContactId) || defaultSiteContact;
  useEffect(() => {
    if (!siteId) {
      setDeliveryContactId("");
      return;
    }
    setDeliveryContactId((current) => siteContacts.some((row: any) => row.id === current) ? current : defaultSiteContact?.id || "");
    setBillingContactId((current) => siteContacts.some((row: any) => row.id === current) ? current : defaultSiteContact?.id || "");
  }, [siteId, defaultSiteContact?.id, siteContacts.length]);
  useEffect(() => {
    if (!siteId) {
      setDeliveryLocationId("");
      return;
    }
    setDeliveryLocationId((current) => deliveryLocations.some((row: any) => row.id === current) ? current : defaultDeliveryLocation?.id || "");
  }, [siteId, defaultDeliveryLocation?.id, deliveryLocations.length]);
  useEffect(() => {
    setDelivery((current) => ({ ...current, location: selectedDeliveryLocation?.location_name || "", address: selectedDeliveryLocation ? deliveryAddressFor(selectedDeliveryLocation) : "" }));
  }, [selectedDeliveryLocation?.id]);
  useEffect(() => {
    setVendorCompletion({ address: "", gstin: "", phone: "", email: "", contact_name: "" });
    setVendorFeedback(null);
  }, [vendorId]);
  const companyTerms = (lookups.terms_templates || []).filter((row: any) => row.company_id === companyId && row.status === "active");
  const selectedTerms = companyTerms.find((row: any) => row.id === termsTemplateId) || companyTerms.sort((a: any, b: any) => Number(b.is_default) - Number(a.is_default))[0];
  useEffect(() => {
    if (previousCompanyIdRef.current !== companyId) {
      setTermsTemplateId("");
      setStandardTerms("");
    }
    previousCompanyIdRef.current = companyId;
  }, [companyId]);
  useEffect(() => {
    setTermsTemplateId(companyTerms.find((row: any) => row.is_default)?.id || companyTerms[0]?.id || "");
    if (!selectedTerms || standardTerms.trim()) return;
    const clauses = (selectedTerms.sections || []).filter((section: any) => section.status === "active").sort((a: any, b: any) => a.sort_order - b.sort_order).map((section: any) => `${section.heading}\n${section.clause_body}`).join("\n\n");
    if (clauses) setStandardTerms(clauses);
  }, [selectedTerms, standardTerms]);
  const indents = useMemo(() => {
    if (!companyId || !siteId) return [];
    return lookups.indents.filter((row: any) => row.company_id === companyId && row.site_id === siteId);
  }, [lookups.indents, companyId, siteId]);
  const indentGroups: any[] = useMemo(() => Array.from(new Map(indents.map((row: any) => [row.requisition_id, { requisition_id: row.requisition_id, requisition_number: row.requisition_number, requisition_date: row.requisition_date, lines: indents.filter((line: any) => line.requisition_id === row.requisition_id) }])).values()), [indents]);
  const selectedIndent = indents.find((row: any) => row.requisition_id === selectedIndentId && row.line_key === indentLineKey) || indents.find((row: any) => row.requisition_id === selectedIndentId);
  const blankItem = () => ({ item_name: "", quantity: "", unit_rate: "", gst_rate: "0" });
  const indentRemainingQuantity = (item: Item) => indents.find((line: any) => line.line_key === item.source_requisition_line_key)?.remaining_quantity;
  const indentContextRef = useRef({ companyId, siteId });
  useEffect(() => {
    const previous = indentContextRef.current;
    if (source === "indent" && (previous.companyId !== companyId || previous.siteId !== siteId)) {
      setItems([blankItem()]);
      setIndentLineKey("");
      setSelectedIndentId("");
    }
    indentContextRef.current = { companyId, siteId };
  }, [companyId, siteId, source]);
  const totals = useMemo(() => { const itemTotals = items.reduce((result, item) => { const taxable = Number(item.quantity || 0) * Number(item.unit_rate || 0); const gst = taxable * Number(item.gst_rate || 0) / 100; return { taxable: result.taxable + taxable, gst: result.gst + gst }; }, { taxable: 0, gst: 0 }); const additional = additionalCharges.reduce((sum, charge) => sum + Math.max(0, Number(charge.amount || 0)), 0); return { ...itemTotals, additional, total: itemTotals.taxable + additional + itemTotals.gst }; }, [items, additionalCharges]);

  function chooseIndent(line: any) {
    setSelectedIndentId(line.requisition_id);
    setIndentLineKey(line.line_key);
    setCompanyId(line.company_id || "");
    setSiteId(line.site_id || "");
    setItems((current) => {
      const existing = current.filter((item) => item.source_requisition_line_key);
      if (existing.some((item) => item.source_requisition_line_key === line.line_key)) return current;
      return [...existing, { item_id: line.item_id, item_name: line.item_name_snapshot || "", item_code: line.item_code_snapshot, description: line.specification, quantity: String(line.remaining_quantity), uom: line.uom_snapshot, unit_rate: "", gst_rate: "0", source_requisition_line_key: line.line_key }];
    });
  }

  function updateItem(index: number, field: keyof Item, value: string) { setItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item)); }

  function selectMaterial(index: number, material: any) {
    setItems((current) => current.map((item, itemIndex) => itemIndex === index ? {
      ...item,
      item_id: material.id,
      item_name: material.item_name || "",
      item_code: material.item_code || "",
      description: material.description || "",
      specification: material.description || "",
      uom: material.default_uom?.uom_name || material.default_uom?.uom_code || "",
      source_requisition_line_key: undefined,
    } : item));
    setMaterialOpenIndex(null);
    setMaterialMenuPosition(null);
  }

  function useCustomItem(index: number) {
    setItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, item_id: undefined, item_code: undefined, uom: item.uom || "", source_requisition_line_key: undefined } : item));
    setMaterialOpenIndex(null);
    setMaterialMenuPosition(null);
  }

  function openMaterialMenu(index: number, input?: HTMLInputElement | null) {
    setMaterialOpenIndex(index);
    const target = input || materialInputRefs.current[index];
    if (target) {
      const rect = target.getBoundingClientRect();
      setMaterialMenuPosition({ index, left: rect.left, top: rect.bottom + 4, width: Math.max(rect.width, 320) });
    }
  }

  function changeSource(value: Source) {
    setSource(value);
    setMessage("");
    setMaterialOpenIndex(null);
    setMaterialMenuPosition(null);
    setIndentLineKey("");
    setSelectedIndentId("");
    if (value !== "direct") {
      setItems([blankItem()]);
      setIndentLineKey("");
      setSelectedIndentId("");
    }
  }

  async function uploadAttachments(purchaseOrderId: string) {
    if (!attachments.length) return;
    const token = await getAccessToken();
    for (const attachment of attachments) {
      const form = new FormData();
      form.set("file", attachment.file);
      form.set("document_type", attachment.documentType);
      form.set("sort_order", String(attachments.indexOf(attachment)));
      const response = await fetch(`/api/procurement/purchase-orders/${purchaseOrderId}/documents`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(`${attachment.file.name}: ${result.error || "upload failed"}`);
      setAttachments((current) => current.filter((candidate) => candidate !== attachment));
    }
  }

  async function removeExistingDocument(document: any) {
    if (!editId || removingDocumentId) return;
    if (!window.confirm(`Remove ${document.original_file_name || "this document"} from this Purchase Order?`)) return;
    setRemovingDocumentId(document.id);
    try {
      await apiFetch(`/api/procurement/purchase-orders/${editId}/documents?document_id=${encodeURIComponent(document.id)}`, { method: "DELETE" });
      setExistingDocuments((current) => current.filter((candidate) => candidate.id !== document.id));
    } catch (error: any) {
      setMessage(error.message || "Failed to remove supporting document.");
    } finally {
      setRemovingDocumentId(null);
    }
  }

  async function completeMissingVendorDetails() {
    if (!selectedVendor || !canEditVendors) return;
    setVendorCompletionSaving(true);
    setVendorFeedback(null);
    setMessage("");
    try {
      const payload = {
        vendor_id: selectedVendor.id,
        address: missingVendorFields.address ? vendorCompletion.address : "",
        gstin: missingVendorFields.gstin ? vendorCompletion.gstin : "",
        phone: missingVendorFields.phone ? vendorCompletion.phone : "",
        email: missingVendorFields.email ? vendorCompletion.email : "",
        contact_name: !selectedVendorContact && (missingVendorFields.phone || missingVendorFields.email) ? vendorCompletion.contact_name : "",
      };
      if (!Object.values(payload).some((value) => String(value || "").trim()) || (!selectedVendorContact && (missingVendorFields.phone || missingVendorFields.email) && !vendorCompletion.contact_name.trim())) {
        setMessage("Enter at least one missing Vendor detail. Contact Name is required when creating a new contact.");
        return;
      }
      const result = await apiFetch("/api/procurement/purchase-orders/vendors/complete-missing", { method: "POST", body: JSON.stringify(payload) });
      const refreshedLookups = await apiFetch("/api/procurement/purchase-orders/lookups");
      setLookups(refreshedLookups);
      setVendorFeedback({ type: "completion-warnings", warnings: result.warnings || {} });
      setVendorCompletion({ address: "", gstin: "", phone: "", email: "", contact_name: "" });
    } catch (error: any) {
      setMessage(error.message || "Failed to save missing Vendor details.");
    } finally {
      setVendorCompletionSaving(false);
    }
  }

  async function save() {
    setMessage("");
    if (!companyId || !siteId || !vendorId) return setMessage("Company, site and Vendor are required.");
    if (!selectedGstBilling?.billing_address) return setMessage(gstBillingMasters.length > 1 ? "Configure exactly one default GST/Billing Master for the selected Company." : "Configure an active GST/Billing Master for the selected Company.");
    if (!selectedLetterhead) return setMessage("Configure a default Ready Letterhead Master for the selected Company.");
    if (!selectedDeliveryLocation) return setMessage(deliveryLocations.length > 1 ? "Select a Delivery Location for this Site." : "Configure an active Delivery Location for the selected Site.");
    if (!selectedBillingContact || !selectedDeliveryContact) return setMessage(siteContacts.length > 1 ? "Select Billing and Delivery Contacts for this Site." : "Configure an active Site Contact for the selected Site.");
    if (!items.length || items.some((item) => !item.item_name || Number(item.quantity) <= 0 || Number(item.unit_rate) < 0 || Number(item.gst_rate) < 0)) return setMessage("Add at least one item with a valid quantity, rate and GST.");
    if (additionalCharges.some((charge) => !charge.name.trim() || !Number.isFinite(Number(charge.amount)) || Number(charge.amount) < 0)) return setMessage("Each additional charge needs a name and a valid non-negative amount.");
    if (!String(selectedVendor?.address || "").trim() && !String(vendorCompletion.address || "").trim()) return setMessage("Vendor Address is required before creating the Purchase Order. Save the missing Vendor details first.");
    if (keyTerms.slice(0, 4).some((term) => !term.terms.trim()) || keyTerms.slice(4).some((term) => !term.description.trim() || !term.terms.trim())) return setMessage("All default Key Terms and any additional terms must have meaningful values.");
    setSaving(true);
    try {
      const deliveryPayload = { expected_date: delivery.expected_date, location: selectedDeliveryLocation.location_name, address: deliveryAddressFor(selectedDeliveryLocation), delivery_location_id: selectedDeliveryLocation.id, site_contact_id: selectedDeliveryContact.id };
      const body = { source_type: source, company_id: companyId, site_id: siteId, vendor_id: vendorId, po_date: poDate, source_requisition_id: selectedIndent?.requisition_id || params.get("requisition_id") || null, items: items.map((item) => ({ ...item, item_id: item.item_id || undefined, unit_rate: Number(item.unit_rate), quantity: Number(item.quantity), gst_rate: Number(item.gst_rate), make_snapshot: item.make })), master_selection: { delivery_location_id: selectedDeliveryLocation.id, billing_contact_id: selectedBillingContact.id, delivery_contact_id: selectedDeliveryContact.id }, delivery: deliveryPayload, commercial: { ...commercial, additional_charges: additionalCharges.map((charge) => ({ name: charge.name.trim(), amount: Number(charge.amount) })) }, standard_terms: standardTerms, standard_terms_template_id: selectedTerms?.id || null, standard_terms_sections: selectedTerms?.sections?.filter((section: any) => section.status === "active").sort((a: any, b: any) => a.sort_order - b.sort_order) || [], key_terms: keyTerms };
      (body as any).creation_request_id = creationRequestId;
      if (editId) {
        await apiFetch(`/api/procurement/purchase-orders/${editId}`, { method: "PUT", body: JSON.stringify(body) });
        try {
          await uploadAttachments(editId);
        } catch (error: any) {
          setCreatedPoId(editId);
          setMessage(`Purchase Order details were saved, but a supporting document upload failed. Please retry the document upload. ${error.message}`);
          return;
        }
        router.push(`/purchase/purchase-orders/${editId}`);
        return;
      }
      const result = await apiFetch("/api/procurement/purchase-orders", { method: "POST", body: JSON.stringify(body) });
      const id = getCreatedId(result.result || result); if (id) { try { await uploadAttachments(id); router.push(`/purchase/purchase-orders/${id}`); } catch (error: any) { setCreatedPoId(id); setMessage(`Purchase Order draft was created, but an attachment failed: ${error.message}`); } } else router.push("/purchase/purchase-orders");
    } catch (error: any) { setMessage(error.message || "Failed to create Purchase Order draft."); }
    finally { setSaving(false); }
  }

  if (loading) return <p className="text-sm text-slate-500">Loading Purchase Order options...</p>;
  return <section className="mx-auto max-w-[1500px] space-y-5 pb-12">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><Link href={editId ? `/purchase/purchase-orders/${editId}` : "/purchase/purchase-orders"} className="text-sm text-slate-500">← {editId ? "Purchase Order" : "Purchase Orders"}</Link><p className="mt-3 text-xs font-semibold uppercase tracking-widest text-amber-700">Purchase</p><h1 className="text-3xl font-bold text-slate-950">{editId ? "Edit Draft Purchase Order" : "Create Purchase Order"}</h1><p className="text-sm text-slate-500">{editId ? "Update the existing Draft Purchase Order." : "Create a simple draft from a direct purchase or approved Material Indent."}</p></div></header>
    {message && <div ref={errorRef} className="scroll-mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert"><div className="flex items-start justify-between gap-3"><div>{message}{createdPoId && <p className="mt-2"><Link className="font-semibold underline" href={`/purchase/purchase-orders/${createdPoId}`}>Open the draft to retry attachments.</Link></p>}</div><button type="button" aria-label="Dismiss error" onClick={() => setMessage("")} className="shrink-0 text-lg font-semibold leading-none text-red-700" title="Dismiss error">×</button></div></div>}
    <section className="rounded-2xl border bg-white p-5 shadow-sm"><h2 className="font-semibold">PO Source</h2><div className="mt-4 grid gap-3 md:grid-cols-3">{(Object.keys(sourceLabels) as Source[]).map((value) => <button type="button" key={value} onClick={() => changeSource(value)} className={`rounded-xl border p-4 text-left ${source === value ? "border-slate-950 bg-slate-50" : "border-slate-200"}`}><p className="font-semibold">{sourceLabels[value]}</p><p className="mt-1 text-xs text-slate-500">{value === "direct" ? "Create manually without an upstream document." : "Use an approved requirement with remaining quantity."}</p></button>)}</div></section>
    <section className="rounded-2xl border bg-white p-5 shadow-sm"><h2 className="font-semibold">Basic Details</h2><div className="mt-4 grid gap-4 md:grid-cols-3"><label className="text-sm font-semibold">Company *<select value={companyId} onChange={(event) => { setCompanyId(event.target.value); setSiteId(""); setIndentLineKey(""); setSelectedIndentId(""); setDeliveryLocationId(""); setDeliveryContactId(""); setCustomDelivery(false); setTermsTemplateId(""); setStandardTerms(""); }} className="mt-1 h-10 w-full rounded-lg border px-3 font-normal"><option value="">Select company</option>{lookups.companies.map((row: any) => <option key={row.id} value={row.id}>{row.company_name}</option>)}</select></label><label className="text-sm font-semibold">Site / Project *<select value={siteId} onChange={(event) => { const value = event.target.value; const next = sites.find((row: any) => row.id === value); setSiteId(value); setIndentLineKey(""); setSelectedIndentId(""); setDeliveryLocationId(""); setDeliveryContactId(""); setCustomDelivery(false); setDelivery((current) => ({ ...current, location: next?.site_name || "", address: next?.location || "" })); }} className="mt-1 h-10 w-full rounded-lg border px-3 font-normal"><option value="">Select site</option>{sites.map((row: any) => <option key={row.id} value={row.id}>{row.site_name}</option>)}</select></label>{source === "indent" && <label className="text-sm font-semibold">Approved Material Indent *<select value={selectedIndentId} onChange={(event) => { setSelectedIndentId(event.target.value); setIndentLineKey(""); setItems([{ item_name: "", quantity: "", unit_rate: "", gst_rate: "0" }]); }} disabled={loading || !companyId || !siteId || indentGroups.length === 0} className="mt-1 h-10 w-full rounded-lg border px-3 font-normal"><option value="">{!companyId || !siteId ? "Select Company and Site first" : loading ? "Loading approved Material Indents..." : indentGroups.length === 0 ? "No approved Material Indents with remaining quantity" : "Select approved Material Indent"}</option>{indentGroups.map((group: any) => <option key={group.requisition_id} value={group.requisition_id}>{group.requisition_number} — {group.lines.length} materials remaining</option>)}</select></label>}<label className="text-sm font-semibold">Vendor *<div className="flex gap-2"><select value={vendorId} onChange={(event) => setVendorId(event.target.value)} className="mt-1 h-10 min-w-0 flex-1 rounded-lg border px-3 font-normal"><option value="">Select Vendor</option>{lookups.vendors.map((row: any) => <option key={row.id} value={row.id}>{row.vendor_name}</option>)}</select><button type="button" onClick={() => canAddVendors && setVendorModalOpen(true)} disabled={!canAddVendors} className="mt-1 whitespace-nowrap rounded-lg border px-3 text-xs font-semibold">+ Add New Vendor</button></div></label><label className="text-sm font-semibold">PO Date<input type="date" value={poDate} onChange={(event) => setPoDate(event.target.value)} className="mt-1 h-10 w-full rounded-lg border px-3 font-normal" /></label></div></section>
    {(
      <section className="rounded-2xl border bg-white p-5 shadow-sm">
        <h2 className="font-semibold">Vendor Details</h2>
        <p className="mt-2 text-sm text-slate-500">
          Vendor information is read from Vendor Master and snapshotted when the draft is created.
        </p>
        {selectedVendor ? <>
          <div className="mt-4 grid gap-4 text-sm md:grid-cols-2 lg:grid-cols-4">
            <div><span className="block text-xs font-semibold uppercase text-slate-500">Vendor Name</span><b>{selectedVendor.vendor_name}</b></div>
            <div><span className="block text-xs font-semibold uppercase text-slate-500">Contractor Type</span><b>{selectedVendor.contractor_type || "Not set"}</b></div>
            <div><span className="block text-xs font-semibold uppercase text-slate-500">PAN</span><b>{selectedVendor.pan || "Not recorded"}</b></div>
            <div><span className="block text-xs font-semibold uppercase text-slate-500">Profile Status</span><b>{selectedVendor.profile_status || "Not set"}</b></div>
          </div>
          <div className="mt-4 grid gap-4 text-sm md:grid-cols-2">
            <div><span className="block text-xs font-semibold uppercase text-slate-500">Address</span>{missingVendorFields.address ? canEditVendors ? <input value={vendorCompletion.address} onChange={(event) => setVendorCompletion({ ...vendorCompletion, address: event.target.value })} placeholder="Enter vendor address" className="mt-1 h-10 w-full rounded-lg border px-3" /> : <span className="text-amber-700">Missing</span> : <b>{selectedVendor.address}</b>}</div>
            <div><span className="block text-xs font-semibold uppercase text-slate-500">GSTIN{gstinRequired ? " *" : ""}</span>{missingVendorFields.gstin ? canEditVendors ? <input value={vendorCompletion.gstin} onChange={(event) => setVendorCompletion({ ...vendorCompletion, gstin: event.target.value.toUpperCase() })} placeholder={gstinRequired ? "Enter GSTIN (required)" : "Enter GSTIN (optional)"} className="mt-1 h-10 w-full rounded-lg border px-3" /> : <span className="text-amber-700">Missing{gstinRequired ? " (required)" : ""}</span> : <b>{selectedVendor.primary_gstin || selectedVendor.gstin}</b>}</div>
            <div><span className="block text-xs font-semibold uppercase text-slate-500">Contact Person</span><b>{selectedVendorContact?.contact_name || "Not recorded"}</b>{!selectedVendorContact && canEditVendors && (missingVendorFields.phone || missingVendorFields.email) && <input value={vendorCompletion.contact_name} onChange={(event) => setVendorCompletion({ ...vendorCompletion, contact_name: event.target.value })} placeholder="Enter contact name" className="mt-1 h-10 w-full rounded-lg border px-3" />}</div>
            <div><span className="block text-xs font-semibold uppercase text-slate-500">Designation</span><b>{selectedVendorContact?.designation || "Not recorded"}</b></div>
            <div><span className="block text-xs font-semibold uppercase text-slate-500">Phone</span>{missingVendorFields.phone ? canEditVendors ? <input value={vendorCompletion.phone} onChange={(event) => setVendorCompletion({ ...vendorCompletion, phone: event.target.value })} placeholder="Enter phone number" className="mt-1 h-10 w-full rounded-lg border px-3" /> : <span className="text-amber-700">Missing</span> : <b>{selectedVendorContact?.contact_number}</b>}</div>
            <div><span className="block text-xs font-semibold uppercase text-slate-500">Email</span>{missingVendorFields.email ? canEditVendors ? <input type="email" value={vendorCompletion.email} onChange={(event) => setVendorCompletion({ ...vendorCompletion, email: event.target.value })} placeholder="Enter email address" className="mt-1 h-10 w-full rounded-lg border px-3" /> : <span className="text-amber-700">Missing</span> : <b>{selectedVendorContact?.email}</b>}</div>
          </div>
          {canEditVendors && missingCompletableVendorFields && <button type="button" onClick={completeMissingVendorDetails} disabled={vendorCompletionSaving} className="mt-4 rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{vendorCompletionSaving ? "Saving Vendor Details..." : "Save Missing Vendor Details"}</button>}
          {vendorFeedback?.type === "completion-warnings" && <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{vendorFeedback.warnings?.mobile_matches?.length > 0 && <p>Phone number is also used by {vendorFeedback.warnings.mobile_matches.map((row: any) => row.vendor_name).filter(Boolean).join(", ")}.</p>}{vendorFeedback.warnings?.email_matches?.length > 0 && <p>Email address is also used by {vendorFeedback.warnings.email_matches.map((row: any) => row.vendor_name).filter(Boolean).join(", ")}.</p>}{!vendorFeedback.warnings?.mobile_matches?.length && !vendorFeedback.warnings?.email_matches?.length && <p>Vendor details saved successfully.</p>}</div>}
        </> : (
          <p className="mt-4 text-sm text-slate-500">Select a Vendor to view available details.</p>
        )}
      </section>
    )}
    {source === "indent" && <section className="rounded-2xl border bg-white p-5 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">Approved Material Indent</h2><span className="text-xs text-slate-500">Only approved indents with remaining quantity are shown.</span></div>{!companyId || !siteId ? <p className="mt-4 text-sm text-slate-500">Select Company and Site to view approved Material Indents.</p> : indentGroups.length === 0 ? <p className="mt-4 text-sm text-slate-500">No approved Material Indents with remaining quantity</p> : <>{!selectedIndentId ? <p className="mt-4 text-sm text-slate-500">Select an approved Material Indent to view its eligible lines.</p> : <div className="mt-4 grid gap-3 md:grid-cols-2"><h3 className="md:col-span-2 text-sm font-semibold">Materials from {indentGroups.find((group: any) => group.requisition_id === selectedIndentId)?.requisition_number}</h3>{indents.filter((line: any) => line.requisition_id === selectedIndentId && !items.some((item) => item.source_requisition_line_key === line.line_key)).map((line: any) => <button type="button" key={line.line_key} onClick={() => chooseIndent(line)} className={`rounded-xl border p-4 text-left ${indentLineKey === line.line_key ? "border-slate-950 bg-slate-50" : "border-slate-200"}`}><div className="flex justify-between gap-3"><b>{line.item_name_snapshot}</b><span className="text-xs font-semibold text-emerald-700">Remaining: {line.remaining_quantity}</span></div><p className="mt-1 text-xs text-slate-500">Approved: {line.quantity} · Ordered: {line.ordered_quantity} · {line.uom_snapshot || "Unit not specified"}</p></button>)}{indents.filter((line: any) => line.requisition_id === selectedIndentId && !items.some((item) => item.source_requisition_line_key === line.line_key)).length === 0 && <p className="md:col-span-2 text-sm text-slate-500">All available Material Indent items have been added to this Purchase Order.</p>}</div>}</>}</section>}
    <section className="rounded-2xl border bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-5"><div><h2 className="font-semibold">Items</h2><p className="text-xs text-slate-500">Taxable = quantity × rate. GST is calculated per line.</p></div>{source === "direct" && <button type="button" onClick={() => setItems((current) => [...current, { item_name: "", quantity: "", unit_rate: "", gst_rate: "0" }])} className="rounded-lg border px-3 py-2 text-sm font-semibold">Add Item</button>}</div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1800px] table-fixed text-left text-sm"><colgroup><col className="w-[280px]" /><col className="w-[240px]" /><col className="w-[180px]" /><col className="w-[120px]" /><col className="w-[120px]" /><col className="w-[130px]" /><col className="w-[110px]" /><col className="w-[130px]" /><col className="w-[130px]" /><col className="w-[140px]" /><col className="w-[100px]" /></colgroup><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-3">Material / Item</th><th className="p-3">Description / Specification</th><th className="p-3">Make / Brand</th><th className="p-3">Quantity</th><th className="p-3">Unit</th><th className="p-3">Rate</th><th className="p-3">GST %</th><th className="p-3">Taxable</th><th className="p-3">GST Amount</th><th className="p-3">Total</th><th className="p-3">Action</th></tr></thead><tbody className="divide-y">{items.map((item, index) => { const taxable = Number(item.quantity || 0) * Number(item.unit_rate || 0); const gst = taxable * Number(item.gst_rate || 0) / 100; const search = item.item_name.trim().toLowerCase(); const matches = search ? (lookups.items || []).filter((material: any) => `${material.item_code || ""} ${material.item_name || ""}`.toLowerCase().includes(search)).slice(0, 8) : []; return <tr key={`${item.source_requisition_line_key || "item"}-${index}`}><td className="relative z-10 p-3"><input ref={(element) => { materialInputRefs.current[index] = element; }} value={item.item_name} readOnly={source !== "direct"} onFocus={(event) => source === "direct" && (event.currentTarget.value.trim() ? openMaterialMenu(index, event.currentTarget) : (setMaterialOpenIndex(null), setMaterialMenuPosition(null)))} onBlur={() => window.setTimeout(() => { setMaterialOpenIndex(null); setMaterialMenuPosition(null); }, 150)} onChange={(event) => { updateItem(index, "item_name", event.target.value); setItems((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, item_id: undefined, item_code: undefined } : row)); if (event.target.value.trim()) openMaterialMenu(index, event.currentTarget); else { setMaterialOpenIndex(null); setMaterialMenuPosition(null); } }} placeholder={source === "direct" ? "Search material name or code..." : "Source-controlled material"} className="h-9 w-64 rounded border px-2 disabled:bg-slate-50" />{item.item_code && <small className="block text-xs text-slate-500">{item.item_code}</small>}{source === "direct" && materialMenuPosition?.index === index && <div data-material-menu="true" style={{ position: "fixed", left: materialMenuPosition.left, top: materialMenuPosition.top, width: materialMenuPosition.width }} className="z-[100] rounded-lg border bg-white p-1 shadow-xl"><div className="max-h-64 overflow-y-auto">{matches.map((material: any) => <button type="button" key={material.id} onMouseDown={(event) => event.preventDefault()} onClick={() => selectMaterial(index, material)} className="block w-full rounded px-3 py-2 text-left hover:bg-slate-50"><span className="block text-xs font-semibold text-slate-500">{material.item_code || "No code"}</span><span className="block text-sm font-semibold">{material.item_name}</span></button>)}{matches.length === 0 && search && <p className="px-3 py-2 text-xs text-slate-500">No matching Material Master item.</p>}</div>{search && <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => useCustomItem(index)} className="w-full border-t px-3 py-2 text-left text-sm font-semibold text-slate-700">+ Use "{item.item_name}" as Custom / New Item</button>}</div>}</td><td className="p-3"><input value={item.description || item.specification || ""} readOnly={source !== "direct"} onChange={(event) => updateItem(index, "description", event.target.value)} className="h-9 w-52 rounded border px-2" /></td><td className="p-3"><input value={item.make || ""} readOnly={false} onChange={(event) => updateItem(index, "make", event.target.value)} className="h-9 w-40 rounded border px-2" placeholder="Select or enter Make / Brand" /></td><td className="p-3"><input type="number" min="0" step="0.001" max={source === "indent" ? indentRemainingQuantity(item) : undefined} value={item.quantity} onChange={(event) => updateItem(index, "quantity", event.target.value)} className="h-9 w-28 rounded border px-2" /></td><td className="p-3">{source === "direct" && !item.item_id ? <input value={item.uom || ""} onChange={(event) => updateItem(index, "uom", event.target.value)} placeholder="Unit" className="h-9 w-24 rounded border px-2" /> : item.uom || "—"}</td><td className="p-3"><input type="number" min="0" step="0.01" value={item.unit_rate} readOnly={false} onChange={(event) => updateItem(index, "unit_rate", event.target.value)} className="h-9 w-28 rounded border px-2" /></td><td className="p-3"><input type="number" min="0" step="0.01" value={item.gst_rate} readOnly={false} onChange={(event) => updateItem(index, "gst_rate", event.target.value)} className="h-9 w-24 rounded border px-2" /></td><td className="p-3">{money(taxable)}</td><td className="p-3">{money(gst)}</td><td className="p-3 font-semibold">{money(taxable + gst)}</td><td className="p-3">{((source === "direct" && items.length > 1) || source === "indent") && <button type="button" onClick={() => { setItems((current) => current.filter((_, itemIndex) => itemIndex !== index)); if (materialOpenIndex === index) { setMaterialOpenIndex(null); setMaterialMenuPosition(null); } }} className="text-xs font-semibold text-red-700">Remove</button>}</td></tr>; })}</tbody></table>
      </div>
    </section>
    <section className="rounded-2xl border bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3"><h2 className="font-semibold">Additional Charges</h2><button type="button" onClick={() => setAdditionalCharges((current) => [...current, { name: "", amount: "" }])} className="rounded-lg border px-3 py-2 text-xs font-semibold">+ Add Charge</button></div>
      {!additionalCharges.length && <p className="mt-4 text-sm text-slate-500">No additional charges.</p>}
      {additionalCharges.map((charge, index) => <div key={index} className="mt-3 grid gap-2 md:grid-cols-[1fr_180px_auto]"><input value={charge.name} onChange={(event) => setAdditionalCharges((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, name: event.target.value } : row))} placeholder="Charge name" className="h-10 rounded-lg border px-3" /><input type="number" min="0" step="0.01" value={charge.amount} onChange={(event) => setAdditionalCharges((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, amount: event.target.value } : row))} placeholder="Amount" className="h-10 rounded-lg border px-3" /><button type="button" onClick={() => setAdditionalCharges((current) => current.filter((_, rowIndex) => rowIndex !== index))} className="text-xs font-semibold text-red-700">Remove</button></div>)}
    </section>
    <section className="rounded-2xl border bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="font-semibold">Supporting Documents</h2><p className="mt-1 text-xs text-slate-500">PDF and image files become part of the Purchase Order PDF. Word, Excel and text files remain available as separate attachments.</p></div>
        <label className="cursor-pointer rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold">Add Files<input type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.txt" className="sr-only" onChange={(event) => { const files = Array.from(event.target.files || []); const existing = new Set(existingDocuments.map((document) => `${String(document.original_file_name || "").trim().toLowerCase()}|${document.size_bytes || 0}|${document.mime_type || ""}`)); const pending = new Set(attachments.map((attachment) => `${attachment.file.name.trim().toLowerCase()}|${attachment.file.size}|${attachment.file.type || ""}`)); const accepted: AttachmentDraft[] = []; const duplicates: string[] = []; for (const file of files) { const key = `${file.name.trim().toLowerCase()}|${file.size}|${file.type || ""}`; if (existing.has(key) || pending.has(key) || accepted.some((attachment) => `${attachment.file.name.trim().toLowerCase()}|${attachment.file.size}|${attachment.file.type || ""}` === key)) duplicates.push(file.name); else { accepted.push({ file, documentType: "other" }); pending.add(key); } } if (duplicates.length) setMessage(`${duplicates.join(", ")} is already attached to this Purchase Order.`); if (accepted.length) setAttachments((current) => [...current, ...accepted]); event.currentTarget.value = ""; }} /></label>
      </div>
      {existingDocuments.length > 0 && <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Existing documents</p><div className="mt-2 space-y-1 text-sm">{existingDocuments.map((document) => <div key={document.id} className="flex flex-wrap items-center justify-between gap-3"><p>{document.original_file_name} <span className="text-xs text-slate-500">· {(["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(document.mime_type) ? "Included in PO PDF" : "Attachment only")}</span></p>{["draft", "sent_back"].includes(editablePoStatus || "") && <button type="button" disabled={removingDocumentId !== null} onClick={() => void removeExistingDocument(document)} className="text-xs font-semibold text-red-700">{removingDocumentId === document.id ? "Removing..." : "Remove"}</button>}</div>)}</div></div>}
      {attachments.length === 0 ? <p className="mt-4 text-sm text-slate-500">No new supporting documents selected.</p> : <div className="mt-4 space-y-2"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">New files</p>{attachments.map((attachment, index) => <div key={`${attachment.file.name}-${index}`} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm"><span className="min-w-0 truncate">{attachment.file.name} <span className="text-xs text-slate-500">({fileSize(attachment.file.size)})</span></span><div className="flex items-center gap-2"><select value={attachment.documentType} onChange={(event) => setAttachments((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, documentType: event.target.value } : row))} className="rounded border px-2 py-1 text-xs"><option value="other">Other</option><option value="technical_document">Technical Document</option><option value="commercial_document">Commercial Document</option><option value="approval_support">Approval Support</option></select><button type="button" onClick={() => setAttachments((current) => current.filter((_, rowIndex) => rowIndex !== index))} className="text-xs font-semibold text-red-700">Remove</button></div></div>)}</div>}
    </section>
    <section className="grid gap-5 lg:grid-cols-[1fr_340px]">
      <div className="space-y-5">
        <section className="rounded-2xl border bg-white p-5 shadow-sm">
          <h2 className="font-semibold">GST, Billing and Delivery</h2>
          <div className="mt-4 space-y-5">
            <div className="border-b pb-5">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-600">Bill To / Billing Details</h3>
              <div className="mt-3 grid gap-4 md:grid-cols-2">
                <div className="text-sm"><span className="block text-xs font-semibold uppercase text-slate-500">Billing Company</span><p className="mt-1 font-semibold">{selectedCompany?.company_name || (companyId ? "Company unavailable" : "Select a company")}</p></div>
                <div className="text-sm"><span className="block text-xs font-semibold uppercase text-slate-500">GSTIN</span><p className="mt-1 font-semibold">{selectedGstBilling?.gstin || (companyId ? "GSTIN unavailable" : "—")}</p></div>
                <div className="text-sm md:col-span-2"><span className="block text-xs font-semibold uppercase text-slate-500">Billing Address</span><p className="mt-1 text-slate-700">{selectedGstBilling && selectedBilling ? `${selectedBilling.label || "Billing Address"} — ${selectedBilling.address}` : siteId ? "No GST/Billing configuration with an active Delivery Location is configured for this Company and Site." : companyId ? "Select a site to resolve the compatible GST/Billing identity." : "Select a company to view Billing Address."}</p></div>
                <label className="text-sm">Billing Contact Person<select value={selectedBillingContact?.id || ""} onChange={(event) => setBillingContactId(event.target.value)} disabled={!siteId || siteContacts.length <= 1} className="mt-1 h-10 w-full rounded-lg border px-3"><option value="">{siteId ? "Select billing contact" : "Select a site first"}</option>{siteContacts.map((row: any) => <option key={row.id} value={row.id}>{row.contact_name}{row.designation ? ` — ${row.designation}` : ""}{row.mobile ? ` — ${row.mobile}` : ""}</option>)}</select>{siteId && siteContacts.length > 1 && !defaultSiteContact && !billingContactId && <span className="mt-1 block text-xs text-amber-700">Select a Billing Contact for this Site.</span>}</label>
                <div className="text-sm"><span className="block text-xs font-semibold uppercase text-slate-500">Letterhead</span><p className="mt-1 text-slate-700">{selectedLetterhead ? `${selectedCompany?.company_name || "Company"} / ${selectedLetterhead.letterhead_name} — Version ${selectedLetterhead.version_number}` : companyId ? "Configure a default Ready Letterhead Master for this Company." : "Select a company to view Letterhead."}</p></div>
              </div>
            </div>
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-600">Delivery Details</h3>
              <div className="mt-3 grid gap-4 md:grid-cols-2">
                <label className="text-sm">Delivery Location<select value={selectedDeliveryLocation?.id || ""} onChange={(event) => setDeliveryLocationId(event.target.value)} disabled={!siteId || deliveryLocations.length <= 1 || Boolean(defaultDeliveryLocation && !deliveryLocationId)} className="mt-1 h-10 w-full rounded-lg border px-3"><option value="">{siteId ? "Select delivery location" : "Select a site first"}</option>{deliveryLocations.map((row: any) => <option key={row.id} value={row.id}>{row.location_name}{deliveryCompanyName(row) ? ` — ${deliveryCompanyName(row)}` : ""}</option>)}</select>{siteId && !deliveryLocations.length && <span className="mt-1 block text-xs text-amber-700">No active Delivery Location is configured for this Site.</span>}{siteId && deliveryLocations.length > 1 && !defaultDeliveryLocation && !deliveryLocationId && <span className="mt-1 block text-xs text-amber-700">Select a Delivery Location for this Site.</span>}</label>
                {selectedDeliveryLocation && deliveryCompanyName(selectedDeliveryLocation) && <div className="text-sm"><span className="block text-xs font-semibold uppercase text-slate-500">Project / Associated Company</span><p className="mt-1 text-slate-700">{deliveryCompanyName(selectedDeliveryLocation)}</p></div>}
                <label className="text-sm md:col-span-2">Delivery Address<textarea value={selectedDeliveryLocation ? deliveryAddressFor(selectedDeliveryLocation) : ""} readOnly className="mt-1 min-h-20 w-full rounded-lg border bg-slate-50 p-3" /></label>
                <label className="text-sm">Delivery Contact Person<select value={selectedDeliveryContact?.id || ""} onChange={(event) => setDeliveryContactId(event.target.value)} disabled={!siteId || siteContacts.length <= 1} className="mt-1 h-10 w-full rounded-lg border px-3"><option value="">{siteId ? "Select delivery contact" : "Select a site first"}</option>{siteContacts.map((row: any) => <option key={row.id} value={row.id}>{row.contact_name}{row.designation ? ` — ${row.designation}` : ""}{row.mobile ? ` — ${row.mobile}` : ""}</option>)}</select>{siteId && siteContacts.length > 1 && !defaultSiteContact && !deliveryContactId && <span className="mt-1 block text-xs text-amber-700">Select a Delivery Contact for this Site.</span>}</label>
                <label className="text-sm">Expected Delivery Date<input type="date" value={delivery.expected_date} onChange={(event) => setDelivery({ ...delivery, expected_date: event.target.value })} className="mt-1 h-10 w-full rounded-lg border px-3" /></label>
              </div>
            </div>
          </div>
        </section>
        <section className="rounded-2xl border bg-white p-5 shadow-sm">
          <div className="flex justify-between gap-3">
            <h2 className="font-semibold">Key Terms</h2><button type="button" onClick={() => setKeyTerms((current) => [...current, { description: "", terms: "" }])} className="rounded-lg border px-3 py-2 text-xs font-semibold">Add Additional Term</button>
          </div>
          {keyTerms.map((term, index) => <div className="mt-3 grid gap-2 md:grid-cols-[1fr_2fr_auto]" key={index}>{index < 4 ? <span className="flex min-h-10 items-center rounded-lg border bg-slate-50 px-3 text-sm font-semibold">{term.description}</span> : <input value={term.description} onChange={(event) => setKeyTerms((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, description: event.target.value } : row))} className="h-10 rounded-lg border px-3" placeholder="Description" />}<textarea value={term.terms} onChange={(event) => setKeyTerms((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, terms: event.target.value } : row))} className="min-h-10 rounded-lg border px-3 py-2" placeholder="Terms" />{index >= 4 && <button type="button" onClick={() => setKeyTerms((current) => current.filter((_, rowIndex) => rowIndex !== index))} className="text-xs font-semibold text-red-700">Remove</button>}</div>)}
        </section>
        <section className="rounded-2xl border bg-white p-5 shadow-sm">
          <h2 className="font-semibold">Standard Terms and Conditions</h2><label className="mt-3 block text-sm font-semibold">Standard Terms Set *<select value={termsTemplateId} onChange={(event) => { setTermsTemplateId(event.target.value); setStandardTerms(""); }} disabled={!companyId || companyTerms.length === 0} className="mt-1 h-10 w-full rounded-lg border px-3 font-normal"><option value="">{companyId ? "Select company terms set" : "Select a company first"}</option>{companyTerms.map((row: any) => <option key={row.id} value={row.id}>{row.template_name}{row.is_default ? " — Default" : ""}</option>)}</select></label><p className="mt-2 text-xs text-slate-500">{selectedTerms ? `${selectedTerms.template_name} is the selected company template. Approved sections are snapshotted with the Purchase Order.` : companyId ? "No company-specific standard terms configured for this company." : "Select a company to view standard terms."}</p>{selectedTerms ? <details className="mt-3 rounded-lg border p-3"><summary className="cursor-pointer text-sm font-semibold">View Terms</summary><div className="mt-3 space-y-3 text-sm">{(selectedTerms.sections || []).filter((section: any) => section.status === "active").sort((a: any, b: any) => a.sort_order - b.sort_order).map((section: any) => <div key={section.id}><b>{section.heading}</b><p className="mt-1 whitespace-pre-wrap text-slate-600">{section.clause_body}</p></div>)}</div></details> : <p className="mt-3 text-xs text-slate-500">Approved wording must be configured by an administrator; no legal wording is invented here.</p>}<textarea value={standardTerms} onChange={(event) => setStandardTerms(event.target.value)} className="mt-3 min-h-24 w-full rounded-lg border p-3" placeholder="Additional authorized terms, if required." /></section>
      </div>
      <aside className="h-fit rounded-2xl border bg-slate-950 p-5 text-white shadow-sm"><h2 className="font-semibold">Order Summary</h2>
        <div className="mt-5 space-y-3 text-sm"><div className="flex justify-between"><span className="text-slate-300">Items Basic / Taxable</span><b>{money(totals.taxable)}</b></div><div className="flex justify-between"><span className="text-slate-300">GST</span><b>{money(totals.gst)}</b></div>{additionalCharges.map((charge, index) => <div className="flex justify-between" key={`${charge.name}-${index}`}><span className="text-slate-300">{charge.name.trim()}</span><b>{money(Number(charge.amount || 0))}</b></div>)}<div className="flex justify-between border-t border-slate-700 pt-3 text-base"><span>Grand Total</span><b>{money(totals.total)}</b></div></div>
        </aside>
    </section>
{vendorModalOpen && canAddVendors && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"><div className="flex h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"><div className="flex items-center justify-between border-b p-4"><div><h2 className="text-lg font-bold">Add Vendor from Vendor Master</h2><p className="text-sm text-slate-500">Use the standard Vendor Master creation and validation flow.</p></div><button type="button" onClick={() => setVendorModalOpen(false)} className="text-sm font-semibold">Close</button></div><div className="min-h-0 flex-1 overflow-y-auto p-6"><VendorCreateForm returnTo="/purchase/purchase-orders/new" onSuccess={handleVendorCreated} onCancel={() => setVendorModalOpen(false)} /></div></div></div>}
    <div className="flex justify-end border-t pt-6"><button type="button" onClick={save} disabled={saving} className="rounded-xl bg-slate-950 px-6 py-3 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Generating..." : "Generate PO"}</button></div>
  </section>;
}
