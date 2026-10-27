import "server-only";
import { createAdminSupabase } from "@/lib/supabase-server";
import { decryptAccount, decryptContact } from "@/lib/encryption";
import { readLine, readOrder, readType } from "@/lib/salesOrders/client";
import type { SalesOrder, SalesOrderLine } from "@/lib/salesOrders/types";
import type { PrintParty, PrintTemplate } from "@/components/salesOrders/SalesOrderPrintDocument";
import type { Account, Contact } from "@/lib/types";

export type PrintData = {
  order: SalesOrder;
  lines: SalesOrderLine[];
  account: PrintParty | null;
  contact: { name: string } | null;
  template: PrintTemplate;
  tenantId: string;
};

const join = (parts: (string | null | undefined)[]) => parts.map((p) => (p ?? "").trim()).filter(Boolean).join(", ");

/**
 * The order, its lines, customer and its TYPE's template, for the print pages. Every query after the first carries the
 * order's own tenant. `tenantId` is the signed-in caller's tenant; null only for the public page, which has already
 * verified a signed token for exactly this order id (the order's tenant then comes from the row itself). Any failure,
 * including a table that does not exist yet, is "no such order".
 */
export async function loadOrderForPrint(orderId: string, tenantId: string | null): Promise<PrintData | null> {
  try {
    const db = createAdminSupabase();
    let q = db.from("sales_orders").select("*").eq("id", orderId);
    if (tenantId) q = q.eq("tenant_id", tenantId);
    const { data } = await q.maybeSingle();
    const order = readOrder(data);
    if (!order) return null;
    const tid = (data as { tenant_id: string }).tenant_id;

    const [lines, type, account, contact] = await Promise.all([
      db.from("sales_order_lines").select("*").eq("order_id", orderId).eq("tenant_id", tid).order("line_no"),
      order.type_id ? db.from("sales_order_types").select("*").eq("id", order.type_id).eq("tenant_id", tid).maybeSingle() : Promise.resolve({ data: null }),
      db.from("accounts").select("*").eq("id", order.account_id).eq("tenant_id", tid).maybeSingle(),
      order.contact_id ? db.from("contacts").select("*").eq("id", order.contact_id).eq("tenant_id", tid).maybeSingle() : Promise.resolve({ data: null }),
    ]);

    const acc = account.data ? decryptAccount(account.data as Account) : null;
    const con = contact.data ? decryptContact(contact.data as Contact) : null;
    const t = readType(type.data);
    return {
      order,
      lines: ((lines.data ?? []) as unknown[]).flatMap((l, i) => { const x = readLine(l, i, orderId); return x ? [x] : []; }),
      account: acc ? { name: acc.name, city: acc.city, phone: acc.phone, email: acc.email, address: join([acc.address_line1, acc.address_line2, acc.city, acc.state, acc.postal_code, acc.country]) } : null,
      contact: con ? { name: con.name } : null,
      template: t ? t.template : null,
      tenantId: tid,
    };
  } catch {
    return null;
  }
}
