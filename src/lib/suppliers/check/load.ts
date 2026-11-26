import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readAllPages } from "@/lib/pagedRead";
import { getEffectiveFieldConfig } from "@/lib/fieldConfig";
import { supplierTotal, type CompareResponse } from "@/lib/rfq/comparison";
import { identityOf, type FieldLabel, type Identity, type SupplierRecord } from "./identity";
import type { QuoteContext } from "./signals";
import { RATING_MONTHS } from "./types";
import type { RatingLine, RatingResponse, RatingRfqSupplier } from "./rating";

// Reads what a check is computed from. EVERY query chains .eq("tenant_id", tenantId): this runs on the service-role client, which
// bypasses RLS (MULTI_TENANT_GUARDRAILS.md). A missing RFQ table (migration pending) reads as "no history", never as an error.

export type LoadedSupplier = SupplierRecord & { city: string | null; ref: string | null };

export type CheckInputs = {
  supplier: LoadedSupplier;
  identity: Identity;
  others: Identity[];
  rfqSuppliers: RatingRfqSupplier[];
  lines: RatingLine[];
  responses: RatingResponse[];
  quote: QuoteContext;
};

const SUPPLIER_COLS = "id, ref, name, type, status, city, email, phone, gstin, notes, custom_data, created_at";
const CHUNK = 120;

const chunks = <T,>(xs: readonly T[], n = CHUNK): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

export function isMissingTable(err: { code?: string; message?: string } | null | undefined): boolean {
  return !!err && (err.code === "42P01" || err.code === "42703" || err.code === "PGRST205" || err.code === "PGRST204"
    || /does not exist|Could not find the table|schema cache/i.test(err.message ?? ""));
}

async function labelsFor(admin: SupabaseClient, tenantId: string): Promise<FieldLabel[]> {
  try {
    const cfg = await getEffectiveFieldConfig(admin, tenantId, "supplier");
    return cfg.sections.flatMap((s) => s.fields).filter((f) => f.kind === "custom").map((f) => ({ field_key: f.field_key, label: f.label }));
  } catch {
    return [];
  }
}

export async function loadSupplier(admin: SupabaseClient, tenantId: string, supplierId: string): Promise<LoadedSupplier | null> {
  const { data } = await admin.from("suppliers").select(SUPPLIER_COLS).eq("id", supplierId).eq("tenant_id", tenantId).maybeSingle();
  return (data as LoadedSupplier | null) ?? null;
}

/** Suppliers of this workspace matching a name or reference, for the dock tool. At most six. */
export async function findSuppliers(admin: SupabaseClient, tenantId: string, term: string): Promise<{ id: string; name: string; ref: string | null; city: string | null }[]> {
  const t = term.trim();
  if (!t) return [];
  const { data } = await readAllPages<{ id: string; name: string; ref: string | null; city: string | null; status: string | null }>((lo, hi) =>
    admin.from("suppliers").select("id, name, ref, city, status").eq("tenant_id", tenantId).order("name", { ascending: true }).order("id", { ascending: true }).range(lo, hi));
  const rows = data ?? [];
  const low = t.toLowerCase();
  const exactRef = rows.filter((r) => (r.ref ?? "").toLowerCase() === low);
  if (exactRef.length) return exactRef.slice(0, 6);
  const exact = rows.filter((r) => r.name.toLowerCase() === low);
  if (exact.length === 1) return exact;
  const words = low.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1);
  const hits = rows.filter((r) => words.length > 0 && words.every((w) => r.name.toLowerCase().includes(w)));
  return hits.slice(0, 6);
}

export async function loadInputs(admin: SupabaseClient, tenantId: string, supplierId: string, now: Date): Promise<CheckInputs | null> {
  const supplier = await loadSupplier(admin, tenantId, supplierId);
  if (!supplier) return null;
  const [labels, all] = await Promise.all([
    labelsFor(admin, tenantId),
    readAllPages<SupplierRecord>((lo, hi) =>
      admin.from("suppliers").select("id, name, status, email, phone, gstin, custom_data, created_at").eq("tenant_id", tenantId).order("id", { ascending: true }).range(lo, hi)),
  ]);
  const identity = identityOf(supplier, labels);
  const others = (all.data ?? []).filter((s) => s.id !== supplierId).map((s) => identityOf(s, labels));

  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - RATING_MONTHS);
  const mine = await readAllPages<RatingRfqSupplier>((lo, hi) =>
    admin.from("rfq_suppliers").select("id, rfq_id, supplier_id, status, sent_at, replied_at")
      .eq("tenant_id", tenantId).eq("supplier_id", supplierId).not("sent_at", "is", null).gte("sent_at", cutoff.toISOString())
      .order("id", { ascending: true }).range(lo, hi));
  const empty = { supplier, identity, others, rfqSuppliers: [], lines: [], responses: [], quote: { subjectTotal: null, peerTotals: [] } };
  if (mine.error || !mine.data?.length) return empty;

  const rfqIds = [...new Set(mine.data.map((r) => r.rfq_id))];
  const rfqSuppliers: RatingRfqSupplier[] = [];
  const lines: RatingLine[] = [];
  for (const ids of chunks(rfqIds)) {
    const [rs, ls] = await Promise.all([
      readAllPages<RatingRfqSupplier>((lo, hi) => admin.from("rfq_suppliers").select("id, rfq_id, supplier_id, status, sent_at, replied_at").eq("tenant_id", tenantId).in("rfq_id", ids).order("id", { ascending: true }).range(lo, hi)),
      readAllPages<RatingLine & { qty: number | null }>((lo, hi) => admin.from("rfq_lines").select("id, rfq_id, status, qty").eq("tenant_id", tenantId).in("rfq_id", ids).order("id", { ascending: true }).range(lo, hi)),
    ]);
    rfqSuppliers.push(...(rs.data ?? []));
    lines.push(...((ls.data ?? []) as (RatingLine & { qty: number | null })[]));
  }
  const responses: RatingResponse[] = [];
  for (const ids of chunks(rfqSuppliers.map((r) => r.id))) {
    const { data } = await readAllPages<RatingResponse>((lo, hi) =>
      admin.from("rfq_responses").select("id, rfq_supplier_id, rfq_line_id, status, unit_price, fx_rate, valid_until, submitted_at, is_awarded")
        .eq("tenant_id", tenantId).in("rfq_supplier_id", ids).order("id", { ascending: true }).range(lo, hi));
    responses.push(...(data ?? []));
  }

  // Quote totals per supplier per RFQ, for "a new supplier with a very large quote": this supplier's largest against the others'.
  const totals = (rfqSupplier: RatingRfqSupplier): number => {
    const ls = (lines as (RatingLine & { qty: number | null })[]).filter((l) => l.rfq_id === rfqSupplier.rfq_id && l.status !== "cancelled").map((l) => ({ id: l.id, qty: l.qty }));
    return supplierTotal(ls, responses.filter((r) => r.rfq_supplier_id === rfqSupplier.id) as unknown as CompareResponse[]);
  };
  const subjectTotals = rfqSuppliers.filter((r) => r.supplier_id === supplierId).map(totals).filter((n) => n > 0);
  const peerTotals = rfqSuppliers.filter((r) => r.supplier_id !== supplierId).map(totals).filter((n) => n > 0);
  return { ...empty, rfqSuppliers, lines, responses, quote: { subjectTotal: subjectTotals.length ? Math.max(...subjectTotals) : null, peerTotals } };
}
