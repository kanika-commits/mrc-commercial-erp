export type PurchaseOrderItemSpecification = {
  description?: string | null;
  specification?: string | null;
};

/** The combined Description / Specification input is authoritative when present. */
export function visiblePurchaseOrderItemSpecification(item: PurchaseOrderItemSpecification) {
  const value = item.description !== undefined ? item.description : item.specification;
  return value ?? "";
}

/** Send the visible combined-field value using the create/update RPC's canonical key. */
export function normalizePurchaseOrderItemSpecification<T extends PurchaseOrderItemSpecification>(item: T): T & { specification: string } {
  return { ...item, specification: visiblePurchaseOrderItemSpecification(item) };
}
