import { isSchemaPending } from "@/lib/marketing/pending";

// The per-seller-unit invoice counter (ZATCA's ICV): 1, 2, 3 ... with no gaps and no reuse, one sequence per seller
// unit (an entity). The number is taken INSIDE the database, by the function `allocate_einvoice_seq` of migration 0219:
//
//   insert into einvoice_counters ... on conflict (tenant_id, seller_key) do update set last_seq = last_seq + 1
//
// is one atomic statement (the conflicting row is locked until the transaction ends), and the same transaction writes
// the number onto the invoice. Two requests at once therefore get two different numbers, and if anything fails after the
// number is taken the whole transaction rolls back and the counter with it -- no gap. There is deliberately NO
// "read the highest, add one, write it" anywhere (unlike the INV-#### ref, whose unique-index retry tolerates a gap).
//
// Calling it again for an invoice that already has a number returns that number (idempotent), so a retry after a
// timeout can never burn a second one.
//
// This file is the typed wrapper; the SQL is the source of truth.

export type SeqClient = {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
};

export type AllocateResult =
  | { ok: true; seq: number }
  | { ok: false; reason: "pending" | "not_found" | "error"; message: string };

export const ALLOCATE_FN = "allocate_einvoice_seq";

export async function allocateEinvoiceSeq(
  client: SeqClient,
  a: { tenantId: string; invoiceId: string; sellerKey: string },
): Promise<AllocateResult> {
  const { data, error } = await client.rpc(ALLOCATE_FN, { p_tenant: a.tenantId, p_invoice: a.invoiceId, p_seller_key: a.sellerKey });
  if (error) {
    // 42883 undefined_function / PGRST202 function not in the schema cache: migration 0219 has not been run yet.
    if (error.code === "42883" || error.code === "PGRST202" || isSchemaPending(error)) {
      return { ok: false, reason: "pending", message: "Needs a database update (bundle 30, e-invoicing data)." };
    }
    if (error.code === "P0002") return { ok: false, reason: "not_found", message: "Invoice not found." };
    return { ok: false, reason: "error", message: error.message ?? "Could not take the next invoice number." };
  }
  const n = typeof data === "number" ? data : Number(data);
  if (!Number.isInteger(n) || n < 1) return { ok: false, reason: "error", message: "The database returned no invoice number." };
  return { ok: true, seq: n };
}
