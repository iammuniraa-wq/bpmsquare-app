import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { lineIsLate, lineIsShort } from "./availability";
import { orderPermissions, type OrderPermissions } from "./lock";
import { loadLines, type OrderRow } from "./server";
import type { SalesOrderLine } from "./types";

// The shape GET /api/sales-orders/[id] answers and every action returns, so the detail screen can redraw from
// any response: the order row, its lines, who it is for, what type it is, where it came from and what may be done.

export type OrderView = OrderRow & OrderPermissions & {
  lines: SalesOrderLine[];
  account: { id: string; name: string } | null;
  contact: { id: string; name: string } | null;
  type: { id: string; name: string; prefix: string; pricing_mode: string } | null;
  /** Ref of the quote / deal / order this one was made from, for "Internal pricing, as quote SQ-…". */
  source_ref: string | null;
  /** The one quiet line under the header: which pricing mode the order uses and why. */
  pricing_label: string;
  attachment_count: number;
  /** A line is late (confirmed after the date asked) or short (confirmed less than asked). Drives the Overview banner. */
  needs_attention: boolean;
};

const SOURCE_TABLE: Record<string, string> = { standard_quote: "standard_quotes", quotation: "quotes", opportunity: "opportunities", order: "sales_orders" };

export function pricingLabel(mode: string, sourceType: string, sourceRef: string | null): string {
  if (mode === "external") return "Prices come from the ERP";
  const kind = { standard_quote: "quote", quotation: "quotation", opportunity: "deal", order: "order" }[sourceType];
  return kind && sourceRef ? `Internal pricing, as ${kind} ${sourceRef}` : "Internal pricing";
}

async function sourceRefOf(db: SupabaseClient, tenantId: string, sourceType: string, sourceId: string | null): Promise<string | null> {
  const table = SOURCE_TABLE[sourceType];
  if (!table || !sourceId) return null;
  const { data, error } = await db.from(table).select("ref").eq("id", sourceId).eq("tenant_id", tenantId).maybeSingle();
  return error ? null : ((data as { ref: string | null } | null)?.ref ?? null);
}

export async function buildOrderView(db: SupabaseClient, tenantId: string, order: OrderRow, erpLinked: boolean): Promise<OrderView> {
  const [lines, accountRes, contactRes, typeRes, sourceRef, attachments] = await Promise.all([
    loadLines(db, tenantId, order.id),
    db.from("accounts").select("id, name").eq("id", order.account_id).eq("tenant_id", tenantId).maybeSingle(),
    order.contact_id ? db.from("contacts").select("id, name").eq("id", order.contact_id).eq("tenant_id", tenantId).maybeSingle() : Promise.resolve({ data: null }),
    order.type_id ? db.from("sales_order_types").select("id, name, prefix, pricing_mode").eq("id", order.type_id).eq("tenant_id", tenantId).maybeSingle() : Promise.resolve({ data: null }),
    sourceRefOf(db, tenantId, order.source_type, order.source_id),
    db.from("sales_order_attachments").select("id").eq("order_id", order.id).eq("tenant_id", tenantId),
  ]);
  return {
    ...order,
    ...orderPermissions(order, erpLinked),
    lines,
    account: (accountRes.data as { id: string; name: string } | null) ?? null,
    contact: (contactRes.data as { id: string; name: string } | null) ?? null,
    type: (typeRes.data as OrderView["type"]) ?? null,
    source_ref: sourceRef,
    pricing_label: pricingLabel(order.pricing_mode, order.source_type, sourceRef),
    attachment_count: attachments.error ? 0 : (attachments.data ?? []).length,
    needs_attention: order.status !== "cancelled" && lines.some((l) => lineIsLate(l) || lineIsShort(l)),
  };
}
