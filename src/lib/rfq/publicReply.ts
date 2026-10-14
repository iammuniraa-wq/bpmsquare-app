import "server-only";
import { headers } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PRIMARY_HOST } from "@/lib/constants";
import { verifyReplyToken } from "./token";
import { loadRfqBundle, loadTenantById, supplierViewFor, type RfqBundle, type RfqSupplierRow } from "./server";
import type { Tenant } from "@/lib/tenant";
import type { SupplierView } from "./compose";

// The supplier's side of the signed reply link: the page and its API share
// this one resolver, so the checks can't drift between them.
//
//   1. the token verifies against the recipient's CURRENT nonce (a rotated
//      or cancelled link is dead) and hasn't expired;
//   2. the request arrived on the tenant's own host -- a link only works on
//      the domain it was issued for (its custom domain, or the primary host
//      when it has none), never on another tenant's;
//   3. the recipient and the RFQ are still open.
// Every later query uses the tenant_id read from the verified row.

export type ReplyContext = {
  tenant: Tenant;
  bundle: RfqBundle;
  rs: RfqSupplierRow;
  view: SupplierView;
  expiresAt: number;
  open: boolean;
};

export type ReplyFailure = { ok: false; reason: "invalid" | "expired" | "closed" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function resolveReply(admin: SupabaseClient, sid: string, token: string): Promise<({ ok: true } & ReplyContext) | ReplyFailure> {
  if (!UUID_RE.test(sid)) return { ok: false, reason: "invalid" };
  const { data: row } = await admin.from("rfq_suppliers").select("id, tenant_id, rfq_id, token_nonce, status").eq("id", sid).maybeSingle();
  if (!row) return { ok: false, reason: "invalid" };
  const check = verifyReplyToken(row.id as string, row.token_nonce as string, decodeURIComponent(token));
  if (!check.ok) return { ok: false, reason: check.reason };

  const tenant = await loadTenantById(admin, row.tenant_id as string);
  if (!tenant || tenant.status === "suspended") return { ok: false, reason: "invalid" };
  const host = ((await headers()).get("host") ?? "").split(":")[0].toLowerCase();
  const expected = (tenant.custom_domain || PRIMARY_HOST).toLowerCase();
  if (host !== expected && host !== "localhost" && host !== "127.0.0.1") return { ok: false, reason: "invalid" };

  const bundle = await loadRfqBundle(admin, tenant.id, row.rfq_id as string, { messages: false });
  if (!bundle) return { ok: false, reason: "invalid" };
  const rs = bundle.suppliers.find((s) => s.id === row.id);
  if (!rs) return { ok: false, reason: "invalid" };
  if (rs.status === "cancelled" || bundle.rfq.status === "cancelled") return { ok: false, reason: "closed" };
  const open = !["closed", "awarded"].includes(bundle.rfq.status) && rs.status !== "expired";
  const view = await supplierViewFor(admin, tenant, bundle, rs);
  return { ok: true, tenant, bundle, rs, view, expiresAt: check.expiresAt, open };
}

/** What the reply page shows the supplier of their OWN earlier answers --
 *  never anyone else's, never the award. */
export function ownResponses(ctx: ReplyContext) {
  return ctx.bundle.responses
    .filter((r) => r.rfq_supplier_id === ctx.rs.id)
    .map((r) => ({
      rfq_line_id: r.rfq_line_id, status: r.status, unit_price: r.unit_price, currency: r.currency,
      lead_time_days: r.lead_time_days, moq: r.moq, offered_description: r.offered_description, valid_until: r.valid_until, note: r.note,
    }));
}

export function ownHeader(ctx: ReplyContext) {
  const rs = ctx.rs;
  return {
    supplier_quote_ref: rs.supplier_quote_ref, currency: rs.currency, incoterm: rs.incoterm,
    freight_amount: rs.freight_amount, payment_terms: rs.payment_terms, valid_until: rs.valid_until, note: rs.note,
    status: rs.status,
  };
}
