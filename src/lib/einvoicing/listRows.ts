import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptAccount } from "@/lib/encryption";
import type { Account } from "@/lib/types";
import { evaluateInvoice } from "./evaluate";
import { loadEinvoiceTenant } from "./server";
import type { EinvoiceInvoiceInput, EinvoiceLineInput } from "./rules";

// The e-invoice columns of the v1 / Talk-to-data invoice list, for a workspace that has e-invoicing on. Returns null for every
// other workspace (so the caller adds nothing, not even a null), and also while migration 0219 is pending (the rows have no
// e-invoice columns to report).

const CHUNK = 200;

export async function loadEinvoiceSummaries(
  supabase: SupabaseClient,
  tenantId: string,
  invoices: (Record<string, unknown> & { id: string; account_id: string })[],
): Promise<Map<string, { einvoice_doc_type: string; einvoice_ready: boolean }> | null> {
  if (invoices.length === 0) return null;
  const tenant = await loadEinvoiceTenant(supabase, tenantId);
  if (!tenant.on || !("einvoice_doc_type" in invoices[0])) return null;

  const accountIds = [...new Set(invoices.map((i) => i.account_id))];
  const [accounts, lines] = await Promise.all([
    chunked(accountIds, async (ids) => (await supabase.from("accounts").select("*").eq("tenant_id", tenantId).in("id", ids)).data ?? []),
    chunked(invoices.map((i) => i.id), async (ids) => (await supabase.from("invoice_lines").select("*").eq("tenant_id", tenantId).in("invoice_id", ids)).data ?? []),
  ]);
  const accountById = new Map((accounts as Account[]).map((a) => [a.id, decryptAccount(a)]));
  const linesByInvoice = new Map<string, EinvoiceLineInput[]>();
  for (const l of lines as (EinvoiceLineInput & { invoice_id: string })[]) {
    const list = linesByInvoice.get(l.invoice_id) ?? [];
    list.push(l);
    linesByInvoice.set(l.invoice_id, list);
  }

  const out = new Map<string, { einvoice_doc_type: string; einvoice_ready: boolean }>();
  for (const inv of invoices) {
    const ev = evaluateInvoice({
      invoice: inv as unknown as EinvoiceInvoiceInput & { entity_id?: string | null; status?: string | null },
      lines: linesByInvoice.get(inv.id) ?? [],
      account: accountById.get(inv.account_id) ?? null,
      entities: tenant.entities,
      config: tenant.config,
      currency: tenant.currency,
    });
    out.set(inv.id, { einvoice_doc_type: ev.docType, einvoice_ready: ev.ready });
  }
  return out;
}

async function chunked<T>(ids: string[], load: (ids: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) out.push(...(await load(ids.slice(i, i + CHUNK))));
  return out;
}
