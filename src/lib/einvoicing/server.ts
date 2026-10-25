import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantConfig, TenantEntity, TenantFeatures } from "@/lib/constants";
import { resolveCurrency } from "@/lib/currency";
import { decryptAccount } from "@/lib/encryption";
import { isSchemaPending } from "@/lib/marketing/pending";
import type { Account, Invoice, InvoiceLine } from "@/lib/types";
import { allocateEinvoiceSeq, type SeqClient } from "./counter";
import { evaluateInvoice, type EinvoiceEvaluation } from "./evaluate";
import { einvoicingOn } from "./gate";
import { ZATCA_RULES, type EinvoiceInvoiceInput, type EinvoiceLineInput, type ReadinessIssue } from "./rules";

// The database-facing half of the e-invoice code. Every query here carries .eq("tenant_id", tenantId); the tenant id is
// always the one a route got from requireTenantUser() (or the host-resolved one a server page already has), never a
// value from a request body.

export type EinvoiceTenant = {
  on: boolean;
  features: Partial<TenantFeatures>;
  config: TenantConfig | null;
  entities: TenantEntity[];
  /** ISO currency code of the workspace. */
  currency: string;
};

export async function loadEinvoiceTenant(supabase: SupabaseClient, tenantId: string): Promise<EinvoiceTenant> {
  const { data } = await supabase.from("tenants").select("features, config").eq("id", tenantId).maybeSingle();
  const features = ((data?.features ?? {}) as Partial<TenantFeatures>) ?? {};
  const config = (data?.config ?? null) as TenantConfig | null;
  return {
    on: einvoicingOn(features, config),
    features,
    config,
    entities: config?.entities ?? [],
    currency: resolveCurrency(config ?? undefined).code,
  };
}

/** Just the yes/no -- for the routes that only need to know whether to accept the extra fields. */
export async function einvoicingEnabled(supabase: SupabaseClient, tenantId: string): Promise<boolean> {
  return (await loadEinvoiceTenant(supabase, tenantId)).on;
}

/** The invoice, its lines and the buyer account (decrypted), all for one tenant. Null when the invoice is not this tenant's. */
export async function loadInvoiceForEinvoice(supabase: SupabaseClient, tenantId: string, invoiceId: string) {
  const { data: invoice } = await supabase.from("invoices").select("*").eq("id", invoiceId).eq("tenant_id", tenantId).maybeSingle();
  if (!invoice) return null;
  const [{ data: lines }, { data: account }] = await Promise.all([
    supabase.from("invoice_lines").select("*").eq("invoice_id", invoiceId).eq("tenant_id", tenantId).order("sl_no"),
    supabase.from("accounts").select("*").eq("id", (invoice as Invoice).account_id).eq("tenant_id", tenantId).maybeSingle(),
  ]);
  return {
    invoice: invoice as Invoice & EinvoiceInvoiceInput,
    lines: (lines ?? []) as (InvoiceLine & EinvoiceLineInput)[],
    account: account ? decryptAccount(account as Account) : null,
  };
}

export async function evaluateInvoiceById(
  supabase: SupabaseClient, tenantId: string, invoiceId: string, t?: EinvoiceTenant,
): Promise<(EinvoiceEvaluation & { tenant: EinvoiceTenant }) | null> {
  const [tenant, loaded] = await Promise.all([t ? Promise.resolve(t) : loadEinvoiceTenant(supabase, tenantId), loadInvoiceForEinvoice(supabase, tenantId, invoiceId)]);
  if (!loaded) return null;
  const ev = evaluateInvoice({
    invoice: loaded.invoice, lines: loaded.lines, account: loaded.account,
    entities: tenant.entities, config: tenant.config, currency: tenant.currency,
  });
  return { ...ev, tenant };
}

/** The date in the Kingdom (UTC+3, no daylight saving) as YYYY-MM-DD. */
export function riyadhDate(d: Date): string {
  return new Date(d.getTime() + 3 * 3600_000).toISOString().slice(0, 10);
}

export type IssueResult =
  | { ok: true; seq: number; uuid: string }
  | { ok: false; reason: "not_ready"; issues: ReadinessIssue[] }
  | { ok: false; reason: "pending" | "not_found" | "error"; message: string };

/**
 * Makes an invoice's e-invoice identity real, at the moment it is sent: checks it is ready, stamps the UUID, the document
 * type, the issue date and time and the supply date if they are empty, and takes its place in the seller's counter. Safe to
 * repeat (every step is idempotent: it keeps a value that is already there). `admin` must be the service-role client -- the
 * counter function is not callable by a member.
 *
 * A future status that locks a cleared or reported invoice (E3) will be checked at the top of this function and in the
 * routes that edit an invoice; E1 has nothing to lock yet.
 */
export async function issueEinvoice(admin: SupabaseClient, tenantId: string, invoiceId: string, tenant?: EinvoiceTenant): Promise<IssueResult> {
  const t = tenant ?? await loadEinvoiceTenant(admin, tenantId);
  const loaded = await loadInvoiceForEinvoice(admin, tenantId, invoiceId);
  if (!loaded) return { ok: false, reason: "not_found", message: "Invoice not found." };

  const ev = evaluateInvoice({
    invoice: loaded.invoice, lines: loaded.lines, account: loaded.account,
    entities: t.entities, config: t.config, currency: t.currency, draft: true,
  });
  if (!ev.ready) return { ok: false, reason: "not_ready", issues: ev.issues };

  const now = new Date();
  const inv = loaded.invoice;
  const patch: Record<string, unknown> = {};
  const uuid = inv.einvoice_uuid ?? randomUUID();
  if (!inv.einvoice_uuid) patch.einvoice_uuid = uuid;
  if (!inv.einvoice_doc_type) patch.einvoice_doc_type = ev.docType;
  const issuedAt = inv.issued_at ?? now.toISOString();
  if (!inv.issued_at) patch.issued_at = issuedAt;
  if (!inv.supply_date) patch.supply_date = riyadhDate(new Date(issuedAt));
  if (Object.keys(patch).length > 0) {
    const { error } = await admin.from("invoices").update(patch).eq("id", invoiceId).eq("tenant_id", tenantId);
    if (error) {
      if (isSchemaPending(error)) return { ok: false, reason: "pending", message: "Needs a database update (bundle 30, e-invoicing data)." };
      return { ok: false, reason: "error", message: error.message };
    }
  }

  const alloc = await allocateEinvoiceSeq(admin as unknown as SeqClient, { tenantId, invoiceId, sellerKey: ev.seller.key });
  if (!alloc.ok) return { ok: false, reason: alloc.reason, message: alloc.message };
  return { ok: true, seq: alloc.seq, uuid };
}

/** Gives every line that has no VAT category the standard category and rate. Returns how many lines it touched. */
export async function applyDefaultVat(supabase: SupabaseClient, tenantId: string, invoiceId: string): Promise<{ updated: number; pending?: boolean }> {
  const { data, error } = await supabase
    .from("invoice_lines")
    .update({ vat_category: "S", vat_rate: ZATCA_RULES.standardRate })
    .eq("invoice_id", invoiceId).eq("tenant_id", tenantId).is("vat_category", null)
    .select("id");
  if (error) return isSchemaPending(error) ? { updated: 0, pending: true } : { updated: 0 };
  return { updated: data?.length ?? 0 };
}

/** The VAT fields a new invoice line gets when the caller did not send them (standard category at the Kingdom's rate). */
export function defaultLineVat() {
  return { vat_category: "S" as const, vat_rate: ZATCA_RULES.standardRate, vat_exemption_reason: null };
}

/** Whether migration 0219 has been applied (the new invoice columns exist). Until it has, no e-invoice rule is enforced. */
export async function einvoiceColumnsPresent(supabase: SupabaseClient): Promise<boolean> {
  const { error } = await supabase.from("invoices").select("einvoice_uuid").limit(1);
  return !(error && isSchemaPending(error));
}

export type IssueGate =
  | { block: false }
  | { block: true; status: number; body: { error: string; issues?: ReadinessIssue[] } };

/**
 * What a route does just before a DRAFT invoice is sent (the status change or the email): for a workspace with e-invoicing
 * on, the invoice must be ready, and sending gives it its UUID, issue time and counter number. For every other workspace,
 * and while migration 0219 is pending, it lets the send through untouched.
 */
export async function gateIssue(admin: SupabaseClient, tenantId: string, invoiceId: string): Promise<IssueGate> {
  const tenant = await loadEinvoiceTenant(admin, tenantId);
  if (!tenant.on) return { block: false };
  if (!(await einvoiceColumnsPresent(admin))) return { block: false };
  const res = await issueEinvoice(admin, tenantId, invoiceId, tenant);
  if (res.ok) return { block: false };
  if (res.reason === "not_ready") {
    const n = res.issues.length;
    return { block: true, status: 422, body: { error: `This invoice is not ready for Saudi e-invoicing: ${n} ${n === 1 ? "thing is" : "things are"} missing.`, issues: res.issues } };
  }
  if (res.reason === "pending") return { block: false };
  return { block: true, status: res.reason === "not_found" ? 404 : 500, body: { error: res.message } };
}
