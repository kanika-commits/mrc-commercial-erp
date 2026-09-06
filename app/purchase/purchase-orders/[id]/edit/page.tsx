import { redirect } from "next/navigation";

export default async function EditPurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/purchase/purchase-orders/new?edit_id=${encodeURIComponent(id)}`);
}
