import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptAccount, decryptContact } from "@/lib/encryption";
import type { Account, Contact } from "@/lib/types";

/**
 * The phone number to open WhatsApp with: the order's contact, else the customer. Phones are stored encrypted, so they
 * are read and decrypted on the server and only this one number is handed to the page. Null on any failure (a missing
 * table, a missing order, no phone on file): the WhatsApp button then says there is no number.
 */
export async function orderCustomerPhone(supabase: SupabaseClient, tenantId: string, orderId: string): Promise<string | null> {
  try {
    const { data: o } = await supabase.from("sales_orders").select("contact_id, account_id").eq("id", orderId).eq("tenant_id", tenantId).maybeSingle();
    const order = o as { contact_id: string | null; account_id: string } | null;
    if (!order) return null;
    if (order.contact_id) {
      const { data: c } = await supabase.from("contacts").select("phone, phone2, phone3").eq("id", order.contact_id).eq("tenant_id", tenantId).maybeSingle();
      const contact = c ? decryptContact(c as unknown as Contact) : null;
      const phone = contact?.phone || contact?.phone2 || contact?.phone3;
      if (phone) return phone;
    }
    const { data: a } = await supabase.from("accounts").select("phone, phone2").eq("id", order.account_id).eq("tenant_id", tenantId).maybeSingle();
    const account = a ? decryptAccount(a as unknown as Account) : null;
    return account?.phone || account?.phone2 || null;
  } catch {
    return null;
  }
}

/**
 * The order already made from this quote / quotation / deal, if any (the newest). Null when there is none, and also on
 * any failure (the table is created by a hand-applied migration): a quote page then simply offers the button.
 */
export async function findOrderForSource(
  supabase: SupabaseClient, tenantId: string, sourceType: "standard_quote" | "quotation" | "opportunity", sourceId: string,
): Promise<{ id: string; ref: string } | null> {
  try {
    const { data, error } = await supabase.from("sales_orders").select("id, ref").eq("tenant_id", tenantId).eq("source_type", sourceType).eq("source_id", sourceId)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    return error || !data ? null : (data as { id: string; ref: string });
  } catch {
    return null;
  }
}
