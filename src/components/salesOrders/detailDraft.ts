// What the "Edit details" panel sends. Pure, so the rule "a locked order only takes customer PO and notes" is tested.

import type { PatchOrderBody } from "@/lib/salesOrders/client";
import type { OrderParty } from "@/lib/salesOrders/types";

export type DetailDraft = {
  customer_po: string; requested_date: string; notes: string; terms: string;
  ship_name: string; ship_address: string; bill_name: string; bill_address: string;
};

const blank = (v: string): string | null => (v.trim() === "" ? null : v.trim());

const party = (name: string, address: string): OrderParty | null => (name.trim() === "" ? null : { name: name.trim(), address: blank(address) });

/** `editable` = the order may still be edited (orderEditable); otherwise only the annotatable fields leave the screen. */
export function detailPatch(d: DetailDraft, editable: boolean): PatchOrderBody {
  const annotate: PatchOrderBody = { customer_po: blank(d.customer_po), notes: blank(d.notes) };
  if (!editable) return annotate;
  return {
    ...annotate,
    requested_date: blank(d.requested_date),
    terms: blank(d.terms),
    ship_to: party(d.ship_name, d.ship_address),
    bill_to: party(d.bill_name, d.bill_address),
  };
}
