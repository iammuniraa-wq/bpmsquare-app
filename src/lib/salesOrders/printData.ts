import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Account, Contact } from "@/lib/types";
import { decryptAccount, decryptContact } from "@/lib/encryption";
import { defaultStandardQuoteBlocks, sanitizeStandardQuoteBlocks } from "@/lib/standardQuoteTemplateBlocks";
import type { StandardQuoteTemplateBlock } from "@/lib/types";
import { loadLines, shapeType, type OrderRow } from "./server";
import type { SalesOrderLine, SalesOrderType } from "./types";

// Everything a printed sales order needs, read for ONE tenant. The staff print page passes the viewer's tenant;
// the public (signed link) page and PDF route derive the tenant from the order row itself, after the token has been
// verified against the order id. Contact details are decrypted here, server-side, and never travel further than the
// rendered document.

export type OrderPrintData = {
  tenantId: string;
  order: OrderRow;
  lines: SalesOrderLine[];
  account: Account | null;
  contact: Contact | null;
  type: SalesOrderType | null;
  blocks: StandardQuoteTemplateBlock[];
  accent: string | null;
  logoPosition: "left" | "center" | "right";
};

export async function loadOrderPrintData(db: SupabaseClient, tenantId: string, id: string): Promise<OrderPrintData | null> {
  const { data: order, error } = await db.from("sales_orders").select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (error || !order) return null;
  const o = order as OrderRow;
  const [lines, accountRes, contactRes, typeRes] = await Promise.all([
    loadLines(db, tenantId, id),
    db.from("accounts").select("*").eq("id", o.account_id).eq("tenant_id", tenantId).maybeSingle(),
    o.contact_id ? db.from("contacts").select("*").eq("id", o.contact_id).eq("tenant_id", tenantId).maybeSingle() : Promise.resolve({ data: null }),
    o.type_id ? db.from("sales_order_types").select("*").eq("id", o.type_id).eq("tenant_id", tenantId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const type = typeRes.data ? shapeType(typeRes.data as Record<string, unknown>) : null;
  const tpl = type?.template;
  return {
    tenantId,
    order: o,
    lines,
    account: accountRes.data ? decryptAccount(accountRes.data as Account) : null,
    contact: contactRes.data ? decryptContact(contactRes.data as Contact) : null,
    type,
    // The type's own design; an order whose type has no blocks (or was removed) prints the standard layout.
    blocks: tpl && tpl.blocks.length > 0 ? sanitizeStandardQuoteBlocks(tpl.blocks) : defaultStandardQuoteBlocks(),
    accent: tpl?.accent_color ?? null,
    logoPosition: tpl?.logo_position ?? "left",
  };
}

/** The tenant that owns an order, from the order row itself (no session): used only after a signed token was verified. */
export async function tenantOfOrder(db: SupabaseClient, id: string): Promise<string | null> {
  const { data, error } = await db.from("sales_orders").select("tenant_id").eq("id", id).maybeSingle();
  return error || !data ? null : ((data as { tenant_id: string }).tenant_id ?? null);
}
