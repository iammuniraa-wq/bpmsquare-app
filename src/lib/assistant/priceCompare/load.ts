import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveCurrency } from "@/lib/currency";
import { rfqConfig, type Rfq } from "@/lib/rfq/types";
import { loadCurrentAwards, type AwardRow } from "@/lib/rfq/awards";
import type { CompareResponse } from "@/lib/rfq/comparison";
import { loadPriceContext, candidatesFor, type SourceLine } from "@/lib/tender/boq/sources";
import { priceValidityDays } from "@/lib/tender/boq/price";
import { promptText } from "@/lib/assistant/promptSafe";
import type { InLine, InSupplier, Reference } from "./compute";
import { dayFor } from "./env";

// Everything the price tools read, on the caller's own session and always with the workspace id on every query. A table that is not there yet
// (the RFQ module, awards, estimates) is an empty answer, never an error the model could be told about. The ids that go in come from the
// caller's own words resolved here, never from the model.

export type RfqHead = Pick<Rfq, "id" | "ref" | "title" | "status" | "origin_type" | "origin_id" | "respond_by">;
const RFQ_COLS = "id, ref, title, status, origin_type, origin_id, respond_by";

export type Resolved =
  | { kind: "ok"; rfq: RfqHead }
  | { kind: "ask"; message: string; options: { ref: string; title: string; status: string }[] }
  | { kind: "none"; message: string };

const num = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const clean = (s: string) => s.replace(/[%,()\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);

/** "RFQ-14", "rfq-0014" and "RFQ-0014" are one reference. */
export function normaliseRef(raw: unknown): { prefix: string; ref: string } | null {
  const m = /^([A-Za-z]{2,8})-(\d{1,8})$/.exec(typeof raw === "string" ? raw.trim() : "");
  return m ? { prefix: m[1].toUpperCase(), ref: `${m[1].toUpperCase()}-${m[2].length < 4 ? m[2].padStart(4, "0") : m[2]}` } : null;
}

const labelOf = (r: Pick<RfqHead, "ref" | "title" | "status">) => ({ ref: r.ref ?? "RFQ", title: r.title, status: r.status });

function askAmong(rows: RfqHead[], what: string): Resolved {
  const options = rows.slice(0, 6).map(labelOf);
  return { kind: "ask", options, message: `${what} matches ${rows.length} RFQs: ${options.map((o) => `${o.ref} (${o.title})`).join("; ")}. Ask the person which one.` };
}

/**
 * The RFQ a person means. A reference of the RFQ itself (RFQ-0014), a reference of a deal (OPP-0034) that has exactly one RFQ with answers,
 * or words from the RFQ's title. More than one match is a question back, never a guess.
 */
export async function resolveRfq(db: SupabaseClient, tenantId: string, reference: unknown, gate: { deals: boolean }): Promise<Resolved> {
  const asRef = normaliseRef(reference);
  const text = typeof reference === "string" ? clean(reference) : "";
  if (!asRef && !text) return { kind: "none", message: "Name the RFQ (for example RFQ-0014) or the deal it belongs to (for example OPP-0034)." };

  if (asRef?.prefix === "RFQ") {
    const { data } = await db.from("rfqs").select(RFQ_COLS).eq("tenant_id", tenantId).eq("ref", asRef.ref).maybeSingle();
    return data ? { kind: "ok", rfq: data as unknown as RfqHead } : { kind: "none", message: `There is no ${asRef.ref} in this workspace.` };
  }

  if (asRef?.prefix === "OPP") {
    if (!gate.deals) return { kind: "none", message: "This person cannot open deals, so name the RFQ itself (for example RFQ-0014)." };
    const { data: deal } = await db.from("opportunities").select("id, ref, title").eq("tenant_id", tenantId).eq("ref", asRef.ref).maybeSingle();
    if (!deal) return { kind: "none", message: `There is no ${asRef.ref} in this workspace.` };
    const dealId = (deal as { id: string }).id;
    const [direct, est] = await Promise.all([
      db.from("rfqs").select(RFQ_COLS).eq("tenant_id", tenantId).eq("origin_type", "opportunity").eq("origin_id", dealId),
      db.from("estimates").select("id").eq("tenant_id", tenantId).eq("opportunity_id", dealId),
    ]);
    const estimateIds = ((est.data ?? []) as { id: string }[]).map((e) => e.id);
    const viaEstimate = estimateIds.length
      ? await db.from("rfqs").select(RFQ_COLS).eq("tenant_id", tenantId).eq("origin_type", "estimate").in("origin_id", estimateIds)
      : { data: [] };
    const rows = [...((direct.data ?? []) as unknown as RfqHead[]), ...((viaEstimate.data ?? []) as unknown as RfqHead[])]
      .filter((r) => r.status !== "cancelled" && r.status !== "draft");
    if (rows.length === 0) return { kind: "none", message: `${asRef.ref} has no RFQ that has been sent yet.` };
    return rows.length === 1 ? { kind: "ok", rfq: rows[0] } : askAmong(rows, asRef.ref);
  }

  if (asRef) return { kind: "none", message: "I can compare the quotes of an RFQ (for example RFQ-0014) or of a deal (for example OPP-0034)." };

  const { data } = await db.from("rfqs").select(RFQ_COLS).eq("tenant_id", tenantId).ilike("title", `%${text}%`).limit(9);
  const rows = ((data ?? []) as unknown as RfqHead[]).filter((r) => r.status !== "cancelled").slice(0, 7);
  if (rows.length === 0) return { kind: "none", message: `No RFQ is called anything like "${text}". Ask for its reference, for example RFQ-0014.` };
  return rows.length === 1 ? { kind: "ok", rfq: rows[0] } : askAmong(rows, `"${text}"`);
}

export type RfqData = {
  rfq: RfqHead;
  lines: InLine[];
  suppliers: InSupplier[];
  responses: CompareResponse[];
  awards: AwardRow[];
  awardsPending: boolean;
  today: string;
  staleDays: number;
  referenceDays: number;
  currencyCode: string;
  config: Record<string, unknown>;
  productByLine: Map<string, string | null>;
  lineStatus: Map<string, string>;
};

export async function loadRfqData(db: SupabaseClient, tenantId: string, rfq: RfqHead, now: Date): Promise<RfqData> {
  const [lineRes, supRes, cfgRes] = await Promise.all([
    db.from("rfq_lines").select("id, sl_no, description, uom, qty, product_id, status").eq("tenant_id", tenantId).eq("rfq_id", rfq.id).order("sl_no", { ascending: true }),
    db.from("rfq_suppliers").select("id, supplier_id, status").eq("tenant_id", tenantId).eq("rfq_id", rfq.id).order("created_at", { ascending: true }),
    db.from("tenants").select("config").eq("id", tenantId).maybeSingle(),
  ]);
  const config = ((cfgRes.data as { config?: Record<string, unknown> } | null)?.config ?? {}) as Record<string, unknown>;
  const lineRows = ((lineRes.data ?? []) as { id: string; sl_no: number; description: string; uom: string | null; qty: unknown; product_id: string | null; status: string }[])
    .filter((l) => l.status !== "cancelled");
  const supRows = (supRes.data ?? []) as { id: string; supplier_id: string; status: string }[];
  const supplierIds = [...new Set(supRows.map((s) => s.supplier_id))];
  const [names, resp] = await Promise.all([
    supplierIds.length ? db.from("suppliers").select("id, name").eq("tenant_id", tenantId).in("id", supplierIds) : Promise.resolve({ data: [] }),
    supRows.length ? db.from("rfq_responses").select("*").eq("tenant_id", tenantId).in("rfq_supplier_id", supRows.map((s) => s.id)) : Promise.resolve({ data: [] }),
  ]);
  const nameOf = new Map(((names.data ?? []) as { id: string; name: string }[]).map((n) => [n.id, n.name]));
  const awards = await loadCurrentAwards(db, tenantId, rfq.id).catch(() => ({ rows: [] as AwardRow[], pending: true }));
  return {
    rfq,
    lines: lineRows.map((l) => ({ id: l.id, slNo: Number(l.sl_no), description: promptText(l.description, 160), uom: l.uom, qty: num(l.qty) })),
    suppliers: supRows.map((s) => ({ id: s.id, supplierId: s.supplier_id, name: promptText(nameOf.get(s.supplier_id) ?? "Supplier", 80) || "Supplier", status: s.status })),
    responses: ((resp.data ?? []) as CompareResponse[]).map((r) => ({ ...r, unit_price: num(r.unit_price), fx_rate: num(r.fx_rate), moq: num(r.moq), lead_time_days: num(r.lead_time_days) })),
    awards: awards.rows,
    awardsPending: awards.pending,
    today: dayFor(config, now),
    staleDays: rfqConfig((config as { rfq?: Parameters<typeof rfqConfig>[0] }).rfq).price_valid_days,
    referenceDays: priceValidityDays(config as Parameters<typeof priceValidityDays>[0]),
    currencyCode: resolveCurrency(config as { currency?: string | null }).code,
    config,
    productByLine: new Map(lineRows.map((l) => [l.id, l.product_id])),
    lineStatus: new Map(lineRows.map((l) => [l.id, l.status])),
  };
}

/** Keeps only the suppliers the person named. A name matches the supplier's name whole, or as a word inside it, never a different supplier. */
export function filterSuppliers(suppliers: InSupplier[], names: readonly string[]): { kept: InSupplier[]; unmatched: string[] } {
  const wanted = names.map((n) => n.trim().toLowerCase()).filter(Boolean);
  if (!wanted.length) return { kept: suppliers, unmatched: [] };
  const hit = (s: InSupplier, w: string) => s.name.toLowerCase() === w || s.name.toLowerCase().split(/\s+/).includes(w) || (w.length >= 4 && s.name.toLowerCase().includes(w));
  const kept = suppliers.filter((s) => wanted.some((w) => hit(s, w)));
  const unmatched = wanted.filter((w) => !suppliers.some((s) => hit(s, w)));
  return { kept, unmatched };
}

/**
 * Our own price for each line, from the places the BOQ already reads (past RFQ answers, the product's cost price, an estimate, a bill of
 * materials), as costs only. This RFQ's own answers are not history and are left out. Past tender projects are selling prices and are not loaded.
 */
export async function loadReferences(db: SupabaseClient, tenantId: string, data: RfqData): Promise<Map<string, Reference[]>> {
  const out = new Map<string, Reference[]>();
  const lines: SourceLine[] = data.lines.map((l) => ({ description: l.description, product_id: data.productByLine.get(l.id) ?? null, cost_code: null, file_rate: null }));
  if (!lines.length) return out;
  try {
    const ctx = await loadPriceContext(db, tenantId, "", lines, null, { skipPastProjects: true });
    const own = data.rfq.ref ? `${data.rfq.ref} ` : null;
    data.lines.forEach((l, i) => {
      const refs = candidatesFor(ctx, lines[i])
        .filter((c) => c.kind === "cost" && (c.source === "supplier" || c.source === "bom") && !(own && c.ref.startsWith(own)))
        .map((c) => ({ label: c.label, price: c.price, asOf: c.as_of }));
      if (refs.length) out.set(l.id, refs);
    });
  } catch {
    return out;
  }
  return out;
}
