import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ROUTES, tenantOrigin, type TenantConfig } from "@/lib/constants";
import { decryptAccount } from "@/lib/encryption";
import type { Account } from "@/lib/types";
import type { CallObject, RenderContext } from "./tokens";

// The object loaders of a Call webhook: one record, read with its tenant, shaped
// as the part of the render context the tokens can reach. The admin client skips
// RLS, so every query names the tenant and the id alone never selects a row.
// Personal data is decrypted only when `allowPii` is true -- otherwise those
// fields are never even read into the context.

export type TenantInfo = { name: string; origin: string; currency: string; isDemo: boolean };

export async function loadTenantInfo(admin: SupabaseClient, tenantId: string): Promise<TenantInfo | null> {
  const { data } = await admin.from("tenants").select("name, custom_domain, config, is_demo").eq("id", tenantId).maybeSingle();
  if (!data) return null;
  const t = data as { name?: string; custom_domain?: string | null; config?: TenantConfig | null; is_demo?: boolean | null };
  return {
    name: String(t.name ?? ""), origin: tenantOrigin(t.custom_domain),
    currency: String((t.config as { currency?: string } | null)?.currency ?? "INR"), isDemo: t.is_demo === true,
  };
}

export type LoadedRecord = {
  /** Fills `account` and/or `quote` and `record` of the context; the caller adds the event fields. */
  parts: Pick<RenderContext, "record"> & { account?: Record<string, unknown>; quote?: Record<string, unknown> };
  /** The readable reference for the Monitor row (ACC-0001, SQ-0012), never a GUID. */
  label: string;
};

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** The cf_ custom fields only: anything else in custom_data is not a token. */
function customFields(raw: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (raw && typeof raw === "object") for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (/^cf_[a-z0-9_]{1,60}$/.test(k)) out[k] = v;
  return out;
}

const ACCOUNT_PII = ["email", "email2", "phone", "phone2", "gstin"] as const;

function accountParts(row: Record<string, unknown>, allowPii: boolean): Record<string, unknown> {
  const a = allowPii ? (decryptAccount(row as unknown as Account) as unknown as Record<string, unknown>) : { ...row };
  if (!allowPii) for (const k of ACCOUNT_PII) delete a[k];
  return { ...a, custom: customFields(row.custom_data) };
}

export async function loadAccountRecord(admin: SupabaseClient, tenantId: string, id: string, origin: string, allowPii: boolean): Promise<LoadedRecord | null> {
  const { data } = await admin.from("accounts").select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!data) return null;
  const row = data as Record<string, unknown>;
  const account = accountParts(row, allowPii);
  return { parts: { record: { id, url: `${origin}${ROUTES.account(id)}` }, account }, label: str(row.ref) ?? str(row.name) ?? "Account" };
}

const QUOTE_COLS = "id, ref, account_id, status, valid_until, terms, notes, subtotal, total, header_discount_pct, tax_pct, shipping_amount, created_at";

export async function loadQuoteRecord(admin: SupabaseClient, tenantId: string, id: string, origin: string, currency: string, allowPii: boolean): Promise<LoadedRecord | null> {
  const { data: q } = await admin.from("standard_quotes").select(QUOTE_COLS).eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!q) return null;
  const quote = q as Record<string, unknown>;
  const [{ data: lineRows }, { data: acct }, { data: links }] = await Promise.all([
    admin.from("standard_quote_lines").select("sl_no, description, uom, qty, rate, discount_pct, amount, is_selected").eq("standard_quote_id", id).eq("tenant_id", tenantId).order("sl_no"),
    admin.from("accounts").select("*").eq("id", quote.account_id as string).eq("tenant_id", tenantId).maybeSingle(),
    admin.from("connector_links").select("connector_id, external_key, external_id").eq("tenant_id", tenantId).eq("object_type", "standard_quotes").eq("object_id", id).eq("direction", "push").not("external_key", "is", null),
  ]);
  // Customer prices only: no cost, margin or internal breakdown is in the line shape.
  const lines = ((lineRows ?? []) as Record<string, unknown>[]).filter((l) => l.is_selected !== false).map((l) => ({
    sl_no: l.sl_no ?? null, description: l.description ?? "", uom: l.uom ?? null, qty: Number(l.qty ?? 1), rate: Number(l.rate ?? 0),
    discount_pct: Number(l.discount_pct ?? 0), amount: Number(l.amount ?? 0),
  }));
  const external: Record<string, string> = {};
  for (const l of (links ?? []) as { connector_id: string; external_key: string | null }[]) {
    if (l.external_key && !l.connector_id.startsWith("webhook:")) external[l.connector_id.replace(/[^a-z0-9_]/gi, "_").toLowerCase()] = l.external_key;
  }
  return {
    parts: {
      record: { id, url: `${origin}${ROUTES.standardQuote(id)}` },
      quote: { ...quote, currency, lines, external },
      ...(acct ? { account: accountParts(acct as Record<string, unknown>, allowPii) } : {}),
    },
    label: str(quote.ref) ?? "Quote",
  };
}

export async function loadCallRecord(admin: SupabaseClient, tenantId: string, objectType: CallObject, id: string, tenant: TenantInfo, allowPii: boolean): Promise<LoadedRecord | null> {
  return objectType === "accounts"
    ? loadAccountRecord(admin, tenantId, id, tenant.origin, allowPii)
    : loadQuoteRecord(admin, tenantId, id, tenant.origin, tenant.currency, allowPii);
}

/** The ten newest records of an object, for the Test tab's picker. Tenant-scoped. */
export async function listSamples(admin: SupabaseClient, tenantId: string, objectType: CallObject): Promise<{ id: string; label: string }[]> {
  if (objectType === "accounts") {
    const { data } = await admin.from("accounts").select("id, ref, name").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(10);
    return ((data ?? []) as { id: string; ref?: string | null; name?: string | null }[]).map((r) => ({ id: r.id, label: [r.ref, r.name].filter(Boolean).join(" ") || r.id }));
  }
  const { data } = await admin.from("standard_quotes").select("id, ref, account_id").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(10);
  return ((data ?? []) as { id: string; ref?: string | null }[]).map((r) => ({ id: r.id, label: r.ref ?? r.id }));
}
