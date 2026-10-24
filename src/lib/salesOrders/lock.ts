import { orderAnnotatable, orderDeletable, orderEditable, type SalesOrder } from "./types";

// What the API tells the screen about an order's lock, in one place so the lock chip, the greyed-out controls
// and the 409 a rejected edit gets all say the same thing. The rules themselves live in types.ts
// (orderEditable / orderAnnotatable / orderDeletable) and are never re-derived here.

type LockInput = Pick<SalesOrder, "origin" | "status">;

export type OrderPermissions = {
  erp_linked: boolean;
  editable: boolean;
  annotatable: boolean;
  deletable: boolean;
  /** Why the lines and header are locked, in words for the lock chip; null while the order is editable. */
  lock_reason: string | null;
};

export function orderLockReason(o: LockInput, erpLinked: boolean): string | null {
  if (orderEditable(o, erpLinked)) return null;
  if (o.status === "cancelled") return "Cancelled orders can't be changed.";
  if (o.origin === "erp") return "This order comes from the ERP and is read-only here.";
  if (erpLinked) return "The ERP has accepted this order, so it can't be changed here.";
  return "Confirmed orders can't be edited. Reopen it to change the lines.";
}

export function orderPermissions(o: LockInput, erpLinked: boolean): OrderPermissions {
  return {
    erp_linked: erpLinked,
    editable: orderEditable(o, erpLinked),
    annotatable: orderAnnotatable(o),
    deletable: orderDeletable(o, erpLinked),
    lock_reason: orderLockReason(o, erpLinked),
  };
}

/** Header fields a PATCH may carry while the order is still a draft made here. */
export const EDITABLE_FIELDS = ["account_id", "contact_id", "type_id", "bill_to", "ship_to", "requested_date", "terms", "shipping_amount", "currency", "opportunity_id"] as const;
/** Fields that stay open on a confirmed order made here (and, of course, on a draft). */
export const ANNOTATABLE_FIELDS = ["notes", "customer_po", "custom_data"] as const;
