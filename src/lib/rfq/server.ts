import "server-only";
import { Resend } from "resend";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireTenantUser, createAdminSupabase, getAuthUser } from "@/lib/supabase-server";
import { resolvePermissions, canViewWorkcenter, canEditWorkcenter } from "@/lib/permissions";
import type { Tenant } from "@/lib/tenant";
import { tenantOrigin, type TenantFeatures } from "@/lib/constants";
import { nextSeqFromRefs } from "@/lib/refSeq";
import { emailOutputFor, resolveOutbound } from "@/lib/emailOutput";
import { logEmail } from "@/lib/emailLog";
import { logChange } from "@/lib/changeLog";
import { tenantToday } from "@/lib/tenantClock";
import { loadMailbox, sendViaMailbox } from "@/lib/mail/mailbox";
import {
  RFQ_LIMITS, RFQ_ATTACHMENT_TYPES, rfqConfig,
  type Rfq, type RfqLine, type RfqSupplier, type RfqResponse, type RfqMessage, type RfqOriginType, type RfqStatus, type RfqAttachment,
} from "./types";
import { deriveRfqStatus, addDays, linkExpiry, type CleanResponse } from "./rules";
import { signReplyToken, mailCode, replyToAddress } from "./token";
import { buildRequestEmail, buildMessageEmail, buildRfqDocumentHtml, type SupplierView } from "./compose";
import { htmlToPdf } from "@/lib/pdf/htmlToPdf";
import { buildReplySheet } from "./sheet";
import { DOC_LINE_TABLE, originHref, validateOriginInput } from "./linking";
import { verifySourceLines } from "./linkingServer";

export { originHref };

// RFQ server core (0128, docs/rfq-architecture.md). Every query here runs on
// the service-role client, because the RFQ tables are select-only under RLS
// -- so EVERY query chains .eq("tenant_id", tenantId) explicitly, and every
// foreign id a caller passes in is verified against the tenant first
// (MULTI_TENANT_GUARDRAILS.md).

export const ATTACHMENT_BUCKET = "quote-attachments";

export function isMissingRelation(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  return err.code === "42P01" || err.code === "PGRST205" || err.code === "42703"
    || /does not exist|Could not find the table/i.test(err.message ?? "");
}

export const PENDING_MESSAGE = "RFQs need migration 0128 applied to this database.";

export type RfqCtx = {
  supabase: SupabaseClient;
  admin: SupabaseClient;
  tenantId: string;
  userId: string;
  role: "admin" | "member";
  email: string | null;
};

/** Route guard: signed in, tenant owns the `rfq` module (404 otherwise, so
 *  the endpoint doesn't advertise itself), and the RFQs workcenter grants
 *  view -- or edit when `edit`. Throws {status, message}. */
export async function rfqAccess(edit: boolean): Promise<RfqCtx> {
  const a = await requireTenantUser();
  const admin = createAdminSupabase();
  const { data } = await admin.from("tenants").select("features").eq("id", a.tenantId).maybeSingle();
  if (!(data?.features as TenantFeatures | undefined)?.rfq) throw { status: 404, message: "Not found" };
  const perms = await resolvePermissions(a.supabase, a.tenantId, a.userId, a.role);
  if (!(edit ? canEditWorkcenter(perms, "rfqs") : canViewWorkcenter(perms, "rfqs"))) throw { status: 403, message: "Forbidden" };
  const user = await getAuthUser();
  return { ...a, admin, email: user?.email ?? null };
}

export function errorResponse(e: unknown): Response {
  const err = e as { status?: number; message?: string };
  return Response.json({ error: err.message ?? "Unexpected error" }, { status: err.status ?? 500 });
}

/** Does this tenant have the module? (used where the caller is not on an
 *  RFQ route -- a quote editor deciding which RFQ flow to show.) */
export async function tenantHasRfq(admin: SupabaseClient, tenantId: string): Promise<boolean> {
  const { data } = await admin.from("tenants").select("features").eq("id", tenantId).maybeSingle();
  return !!(data?.features as TenantFeatures | undefined)?.rfq;
}

// ── Refs ────────────────────────────────────────────────────────────────────

async function allRefs(admin: SupabaseClient, table: string, tenantId: string): Promise<string[]> {
  const out: string[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from(table).select("ref").eq("tenant_id", tenantId).like("ref", "RFQ-%").range(from, from + 999);
    if (error) return out; // pricing_rfqs absent on a fresh DB is fine
    const rows = (data ?? []) as { ref: string | null }[];
    out.push(...rows.map((r) => r.ref ?? "").filter(Boolean));
    if (rows.length < 1000) break;
  }
  return out;
}

/** Next RFQ-#### -- continues past BOTH the new rfqs and the legacy
 *  pricing_rfqs refs, so a tenant that raised legacy RFQs after the backfill
 *  never gets a duplicate number across the two. */
async function nextRfqSeq(admin: SupabaseClient, tenantId: string): Promise<number> {
  const [a, b] = await Promise.all([allRefs(admin, "rfqs", tenantId), allRefs(admin, "pricing_rfqs", tenantId)]);
  return nextSeqFromRefs([...a, ...b], /^RFQ-(\d+)$/);
}

const fmtRef = (seq: number) => `RFQ-${String(seq).padStart(4, "0")}`;

// ── Origins ─────────────────────────────────────────────────────────────────

const ORIGIN: Partial<Record<RfqOriginType, { table: string; label: string; feature: keyof TenantFeatures }>> = {
  standard_quote: { table: "standard_quotes", label: "ref", feature: "standard_quotes" },
  quote: { table: "quotes", label: "ref", feature: "quotations" },
  opportunity: { table: "opportunities", label: "ref", feature: "pipeline" },
  case: { table: "service_cases", label: "ref", feature: "cases" },
  inspection_report: { table: "inspection_reports", label: "case_id", feature: "cases" },
  work_order: { table: "work_orders", label: "ref", feature: "work_orders" },
  fence_project: { table: "fence_projects", label: "ref", feature: "fence_projects" },
};

/** Verifies an origin id belongs to the tenant and returns its display
 *  label. Throws 404 on a foreign or missing id. */
export async function resolveOrigin(admin: SupabaseClient, tenantId: string, type: RfqOriginType, id: string | null): Promise<string | null> {
  const def = ORIGIN[type];
  if (!def || !id) return null;
  const { data } = await admin.from(def.table).select(`id, ${def.label}`).eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!data) throw { status: 404, message: "The record this RFQ is for was not found" };
  if (type === "inspection_report") {
    const caseId = (data as unknown as { case_id: string }).case_id;
    const { data: c } = await admin.from("service_cases").select("ref").eq("id", caseId).eq("tenant_id", tenantId).maybeSingle();
    return c?.ref ? `Inspection · ${c.ref}` : "Inspection report";
  }
  return ((data as unknown as Record<string, unknown>)[def.label] as string | null) ?? null;
}

// ── Create ──────────────────────────────────────────────────────────────────

export type NewRfqLine = {
  product_id?: string | null;
  description?: string | null;
  spec?: string | null;
  uom?: string | null;
  qty?: number | string | null;
  required_by?: string | null;
  cost_model_code?: string | null;
  path?: string | null;
  /** The document line this RFQ line asks about (a quote, standard quote or
   *  deal line). After create, that line is stamped with the new
   *  rfq_line_id -- verified to belong to the origin document first. */
  source_line_id?: string | null;
};

export type NewRfq = {
  title?: string | null;
  origin_type?: RfqOriginType;
  origin_id?: string | null;
  respond_by?: string | null;
  required_by?: string | null;
  delivery_terms?: string | null;
  currency?: string | null;
  notes_to_supplier?: string | null;
  notes_internal?: string | null;
  lines: NewRfqLine[];
  supplier_ids?: string[];
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const date = (v: unknown): string | null => (typeof v === "string" && DATE_RE.test(v) ? v : null);

/** Normalises and verifies lines: product ids must belong to the tenant; a
 *  line with a product takes the product's name/uom when it carries none. */
export async function cleanLines(admin: SupabaseClient, tenantId: string, lines: NewRfqLine[]): Promise<Omit<RfqLine, "id" | "rfq_id" | "status" | "awarded_response_id" | "awarded_unit_cost" | "cost_input_id">[]> {
  if (!Array.isArray(lines) || lines.length === 0) throw { status: 422, message: "Add at least one line." };
  if (lines.length > RFQ_LIMITS.maxLines) throw { status: 422, message: `An RFQ can carry at most ${RFQ_LIMITS.maxLines} lines.` };
  const productIds = [...new Set(lines.map((l) => l.product_id).filter((x): x is string => typeof x === "string" && !!x))];
  const products = new Map<string, { name: string; uom: string | null }>();
  if (productIds.length) {
    const { data } = await admin.from("products").select("id, name, uom").eq("tenant_id", tenantId).in("id", productIds);
    for (const p of (data ?? []) as { id: string; name: string; uom: string | null }[]) products.set(p.id, { name: p.name, uom: p.uom });
    if (products.size !== productIds.length) throw { status: 404, message: "A product on this RFQ was not found." };
  }
  return lines.map((l, i) => {
    const p = l.product_id ? products.get(l.product_id) : undefined;
    const description = str(l.description, 1000) ?? p?.name ?? null;
    if (!description) throw { status: 422, message: `Line ${i + 1} needs a description.` };
    const qtyN = l.qty === null || l.qty === undefined || l.qty === "" ? null : Number(l.qty);
    if (qtyN !== null && (!Number.isFinite(qtyN) || qtyN < 0 || qtyN > 1e9)) throw { status: 422, message: `Line ${i + 1}: quantity must be a positive number.` };
    const path = str(l.path, 200) ?? "purchase.unit_cost";
    if (/__|constructor|prototype/.test(path)) throw { status: 422, message: "Illegal path" };
    return {
      sl_no: i + 1,
      product_id: p ? (l.product_id as string) : null,
      description,
      spec: str(l.spec, 2000),
      uom: str(l.uom, 20) ?? p?.uom ?? null,
      qty: qtyN,
      required_by: date(l.required_by),
      cost_model_code: str(l.cost_model_code, 60)?.toUpperCase() ?? null,
      path,
    };
  });
}

async function verifySuppliers(admin: SupabaseClient, tenantId: string, ids: string[]): Promise<{ id: string; name: string; email: string | null }[]> {
  const unique = [...new Set(ids.filter((x) => typeof x === "string" && x))];
  if (unique.length === 0) return [];
  if (unique.length > RFQ_LIMITS.maxSuppliers) throw { status: 422, message: `At most ${RFQ_LIMITS.maxSuppliers} suppliers per RFQ.` };
  const { data } = await admin.from("suppliers").select("id, name, email").eq("tenant_id", tenantId).in("id", unique);
  const rows = (data ?? []) as { id: string; name: string; email: string | null }[];
  if (rows.length !== unique.length) throw { status: 404, message: "A supplier on this RFQ was not found." };
  return rows;
}

export async function createRfq(ctx: Pick<RfqCtx, "admin" | "tenantId" | "userId" | "email">, input: NewRfq, cfg: ReturnType<typeof rfqConfig>): Promise<{ id: string; ref: string }> {
  const { admin, tenantId, userId } = ctx;
  const originType: RfqOriginType = input.origin_type ?? "manual";
  // Always linked: an RFQ from a quote / case / work order must name it, the
  // record must be this tenant's, and every document line it claims must be
  // a line of that record. The label is read from the record, never the client.
  const originProblem = validateOriginInput(originType, input.origin_id);
  if (originProblem) throw { status: 422, message: originProblem };
  const originLabel = await resolveOrigin(admin, tenantId, originType, input.origin_id ?? null);
  await verifySourceLines(admin, tenantId, originType, ORIGIN[originType] ? input.origin_id ?? null : null, Array.isArray(input.lines) ? input.lines : []);
  const lines = await cleanLines(admin, tenantId, input.lines);
  const suppliers = await verifySuppliers(admin, tenantId, input.supplier_ids ?? []);
  const today = await tenantToday(tenantId);
  const title = str(input.title, 200) ?? (lines.length === 1 ? lines[0].description.slice(0, 200) : `${lines[0].description.slice(0, 150)} + ${lines.length - 1} more`);

  const header = {
    tenant_id: tenantId,
    title,
    status: "draft" as RfqStatus,
    origin_type: originType,
    origin_id: ORIGIN[originType] ? input.origin_id ?? null : null,
    origin_label: originLabel,
    requested_by: userId,
    buyer_id: userId,
    respond_by: date(input.respond_by) ?? addDays(today, cfg.default_response_days),
    required_by: date(input.required_by),
    delivery_terms: str(input.delivery_terms, 500),
    currency: str(input.currency, 3)?.toUpperCase() ?? null,
    notes_to_supplier: str(input.notes_to_supplier, RFQ_LIMITS.maxText),
    notes_internal: str(input.notes_internal, RFQ_LIMITS.maxText),
  };

  let rfq: { id: string; ref: string } | null = null;
  let seq = await nextRfqSeq(admin, tenantId);
  for (let attempt = 0; attempt < 5 && !rfq; attempt++, seq++) {
    const { data, error } = await admin.from("rfqs").insert({ ...header, ref: fmtRef(seq) }).select("id, ref").single();
    if (!error) { rfq = data as { id: string; ref: string }; break; }
    if (isMissingRelation(error)) throw { status: 503, message: PENDING_MESSAGE };
    if (error.code !== "23505") throw { status: 500, message: error.message };
  }
  if (!rfq) throw { status: 500, message: "Could not allocate an RFQ number" };

  const { data: insertedLines, error: lineErr } = await admin.from("rfq_lines")
    .insert(lines.map((l) => ({ ...l, tenant_id: tenantId, rfq_id: rfq!.id }))).select("id, sl_no");
  if (lineErr) {
    await admin.from("rfqs").delete().eq("id", rfq.id).eq("tenant_id", tenantId);
    throw { status: 500, message: lineErr.message };
  }
  // Stamp each source document line with the RFQ line that asks about it,
  // so the quote/deal shows "RFQ-0012 · 1/3" on that line from now on.
  const bySl = new Map(((insertedLines ?? []) as { id: string; sl_no: number }[]).map((r) => [r.sl_no, r.id]));
  const pairs = input.lines
    .map((l, i) => ({ source: typeof l.source_line_id === "string" ? l.source_line_id : null, rfqLine: bySl.get(i + 1) }))
    .filter((x): x is { source: string; rfqLine: string } => !!x.source && !!x.rfqLine);
  if (pairs.length && input.origin_id) await linkDocumentLines(admin, tenantId, originType, input.origin_id, pairs);
  if (suppliers.length) {
    await admin.from("rfq_suppliers").insert(suppliers.map((s) => ({ tenant_id: tenantId, rfq_id: rfq!.id, supplier_id: s.id, email_to: s.email })));
  }
  await logChange(admin, {
    tenantId, objectType: "rfqs", objectId: rfq.id, objectLabel: rfq.ref, action: "create",
    actorId: userId, actorEmail: ctx.email,
    changes: [
      { field: "title", from: null, to: title },
      { field: "lines", from: null, to: lines.length },
      ...(originLabel ? [{ field: "origin", from: null, to: `${originType} ${originLabel}` }] : []),
      ...(suppliers.length ? [{ field: "suppliers", from: null, to: suppliers.map((s) => s.name).join(", ") }] : []),
    ],
  });
  return rfq;
}

// ── Document lines <-> RFQ lines ────────────────────────────────────────────


/** Stamp document lines with their RFQ line. Each update is held to the
 *  tenant AND the origin document, so a line id from another quote (or
 *  another tenant) simply matches nothing. */
export async function linkDocumentLines(admin: SupabaseClient, tenantId: string, originType: RfqOriginType, originId: string, pairs: { source: string; rfqLine: string }[]): Promise<number> {
  const def = DOC_LINE_TABLE[originType];
  if (!def) return 0;
  let linked = 0;
  for (const p of pairs.slice(0, RFQ_LIMITS.maxLines)) {
    const { data, error } = await admin.from(def.table).update({ rfq_line_id: p.rfqLine })
      .eq("id", p.source).eq("tenant_id", tenantId).eq(def.parent, originId).select("id");
    if (error) return linked; // 0128 pending on the line table: nothing to stamp
    linked += (data ?? []).length;
  }
  return linked;
}

export type RfqLineStatus = { rfq_id: string; ref: string | null; rfq_status: string | null; line_status: string; asked: number; replied: number; awarded: boolean; awarded_unit_cost: number | null };

/** Where each RFQ line stands -- status and counts only, never a supplier's
 *  price except the awarded cost (which is the tenant's own cost figure). */
export async function rfqLineStatuses(admin: SupabaseClient, tenantId: string, rfqLineIds: string[]): Promise<Record<string, RfqLineStatus>> {
  const ids = [...new Set(rfqLineIds.filter((x) => /^[0-9a-f-]{36}$/i.test(x)))].slice(0, 500);
  if (!ids.length) return {};
  const { data: lines, error } = await admin.from("rfq_lines").select("id, rfq_id, status, awarded_unit_cost, rfqs(ref, status)").eq("tenant_id", tenantId).in("id", ids);
  if (error) return {};
  const rows = (lines ?? []) as unknown as { id: string; rfq_id: string; status: string; awarded_unit_cost: number | null; rfqs: { ref: string; status: string } | null }[];
  const rfqIds = [...new Set(rows.map((r) => r.rfq_id))];
  const { data: sups } = rfqIds.length ? await admin.from("rfq_suppliers").select("rfq_id, status").eq("tenant_id", tenantId).in("rfq_id", rfqIds) : { data: [] };
  const counts = new Map<string, { asked: number; replied: number }>();
  for (const s of (sups ?? []) as { rfq_id: string; status: string }[]) {
    if (s.status === "cancelled" || s.status === "pending") continue;
    const c = counts.get(s.rfq_id) ?? { asked: 0, replied: 0 };
    c.asked++;
    if (s.status === "replied" || s.status === "declined") c.replied++;
    counts.set(s.rfq_id, c);
  }
  const out: Record<string, RfqLineStatus> = {};
  for (const r of rows) {
    const c = counts.get(r.rfq_id) ?? { asked: 0, replied: 0 };
    out[r.id] = { rfq_id: r.rfq_id, ref: r.rfqs?.ref ?? null, rfq_status: r.rfqs?.status ?? null, line_status: r.status, asked: c.asked, replied: c.replied, awarded: r.status === "awarded", awarded_unit_cost: r.awarded_unit_cost === null ? null : Number(r.awarded_unit_cost) };
  }
  return out;
}

/** For an RFQ raised from a document: which document line each RFQ line is
 *  on, for the "Used on" note on the RFQ screen. */
export async function documentLinesFor(admin: SupabaseClient, tenantId: string, originType: RfqOriginType, originId: string | null, rfqLineIds: string[]): Promise<Record<string, { sl_no: string | null; description: string }>> {
  const def = DOC_LINE_TABLE[originType];
  if (!def || !originId || !rfqLineIds.length) return {};
  const { data, error } = await admin.from(def.table).select("rfq_line_id, sl_no, description")
    .eq("tenant_id", tenantId).eq(def.parent, originId).in("rfq_line_id", rfqLineIds);
  if (error) return {};
  const out: Record<string, { sl_no: string | null; description: string }> = {};
  for (const r of (data ?? []) as { rfq_line_id: string; sl_no: string | number | null; description: string }[]) {
    out[r.rfq_line_id] = { sl_no: r.sl_no === null ? null : String(r.sl_no), description: r.description };
  }
  return out;
}

// ── Load ────────────────────────────────────────────────────────────────────

export type RfqSupplierRow = RfqSupplier & { token_nonce: string; suppliers: { id: string; ref: string | null; name: string; email: string | null; phone: string | null } | null };

export type RfqBundle = {
  rfq: Rfq;
  lines: RfqLine[];
  suppliers: RfqSupplierRow[];
  responses: RfqResponse[];
  messages: RfqMessage[];
};

export async function loadRfqBundle(admin: SupabaseClient, tenantId: string, id: string, opts: { messages?: boolean } = {}): Promise<RfqBundle | null> {
  const { data: rfq, error } = await admin.from("rfqs").select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (error) {
    if (isMissingRelation(error)) throw { status: 503, message: PENDING_MESSAGE };
    throw { status: 500, message: error.message };
  }
  if (!rfq) return null;
  const [lines, suppliers] = await Promise.all([
    admin.from("rfq_lines").select("*").eq("tenant_id", tenantId).eq("rfq_id", id).order("sl_no"),
    admin.from("rfq_suppliers").select("*, suppliers(id, ref, name, email, phone)").eq("tenant_id", tenantId).eq("rfq_id", id).order("created_at"),
  ]);
  const supplierRows = (suppliers.data ?? []) as RfqSupplierRow[];
  const sids = supplierRows.map((s) => s.id);
  const [responses, messages] = await Promise.all([
    sids.length ? admin.from("rfq_responses").select("*").eq("tenant_id", tenantId).in("rfq_supplier_id", sids) : Promise.resolve({ data: [] }),
    opts.messages === false ? Promise.resolve({ data: [] }) : admin.from("rfq_messages").select("*").eq("tenant_id", tenantId).eq("rfq_id", id).order("created_at").limit(500),
  ]);
  const num = <T extends Record<string, unknown>>(row: T, keys: string[]): T => {
    const out: Record<string, unknown> = { ...row };
    for (const k of keys) if (out[k] !== null && out[k] !== undefined) out[k] = Number(out[k]);
    return out as T;
  };
  return {
    rfq: rfq as Rfq,
    lines: ((lines.data ?? []) as RfqLine[]).map((l) => num(l, ["qty", "awarded_unit_cost"])),
    suppliers: supplierRows.map((s) => num(s, ["freight_amount"])),
    responses: ((responses.data ?? []) as RfqResponse[]).map((r) => num(r, ["unit_price", "fx_rate", "moq"])),
    messages: (messages.data ?? []) as RfqMessage[],
  };
}

/** Recompute the header status from its children and store it when it
 *  moved. Returns the new status. */
export async function refreshRfqStatus(admin: SupabaseClient, tenantId: string, rfqId: string): Promise<RfqStatus | null> {
  const [{ data: rfq }, { data: sups }, { data: lines }] = await Promise.all([
    admin.from("rfqs").select("status").eq("id", rfqId).eq("tenant_id", tenantId).maybeSingle(),
    admin.from("rfq_suppliers").select("status").eq("tenant_id", tenantId).eq("rfq_id", rfqId),
    admin.from("rfq_lines").select("status").eq("tenant_id", tenantId).eq("rfq_id", rfqId),
  ]);
  if (!rfq) return null;
  const next = deriveRfqStatus(rfq.status as RfqStatus, (sups ?? []) as { status: RfqSupplier["status"] }[], (lines ?? []) as { status: RfqLine["status"] }[]);
  if (next !== rfq.status) {
    await admin.from("rfqs").update({ status: next, updated_at: new Date().toISOString() }).eq("id", rfqId).eq("tenant_id", tenantId);
  }
  return next;
}

// ── What a supplier may see ────────────────────────────────────────────────

/** The ONE projection every supplier-facing surface reads (email, sheet,
 *  reply page): no customer, no quote ref, no prices, no other supplier. */
export async function supplierViewFor(admin: SupabaseClient, tenant: Pick<Tenant, "name" | "company_info" | "config">, b: Pick<RfqBundle, "rfq" | "lines">, rs: Pick<RfqSupplierRow, "suppliers" | "contact_name">): Promise<SupplierView> {
  let buyerName: string | null = null;
  let buyerEmail: string | null = tenant.company_info?.email || null;
  if (b.rfq.buyer_id) {
    const { data } = await admin.auth.admin.getUserById(b.rfq.buyer_id).catch(() => ({ data: null }));
    const u = data?.user;
    if (u) {
      const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
      buyerName = (typeof meta.full_name === "string" && meta.full_name) || (typeof meta.name === "string" && meta.name) || null;
      buyerEmail = u.email ?? buyerEmail;
    }
  }
  const cfg = rfqConfig(tenant.config?.rfq);
  return {
    tenantName: tenant.name,
    ref: b.rfq.ref ?? "RFQ",
    title: b.rfq.title,
    respondBy: b.rfq.respond_by,
    requiredBy: b.rfq.required_by,
    deliveryTerms: b.rfq.delivery_terms,
    notesToSupplier: b.rfq.notes_to_supplier,
    terms: cfg.terms || null,
    supplierName: rs.contact_name || rs.suppliers?.name || "Supplier",
    buyerName,
    buyerEmail,
    lines: b.lines.filter((l) => l.status !== "cancelled").map((l) => ({
      id: l.id, sl_no: l.sl_no, description: l.description, spec: l.spec, uom: l.uom, qty: l.qty, required_by: l.required_by,
    })),
  };
}

/** The supplier's signed reply page on the TENANT's own domain (never
 *  PRIMARY_HOST -- MULTI_TENANT_GUARDRAILS.md "links that leave the
 *  system"). Null when no link secret is configured. */
export function replyLink(tenant: Pick<Tenant, "custom_domain">, rsId: string, nonce: string, expiresAt: number): string | null {
  const token = signReplyToken(rsId, nonce, expiresAt);
  if (!token) return null;
  return `${tenantOrigin(tenant.custom_domain)}/rfq-reply/${rsId}/${encodeURIComponent(token)}`;
}

// ── The printable RFQ ───────────────────────────────────────────────────────

/** The RFQ as a PDF, supplier-agnostic so one render serves a whole send.
 *  Never throws: a PDF that fails to render must not stop the email. */
export async function renderRfqPdf(admin: SupabaseClient, tenant: Tenant, bundle: Pick<RfqBundle, "rfq" | "lines">): Promise<Buffer | null> {
  try {
    const view = await supplierViewFor(admin, tenant, bundle, { suppliers: null, contact_name: null });
    const today = await tenantToday(tenant.id);
    const storageHost = (() => { try { return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname; } catch { return ""; } })();
    const info = tenant.company_info as unknown as Record<string, unknown> | null;
    const address = typeof info?.address === "string" ? info.address : null;
    return await htmlToPdf(buildRfqDocumentHtml(view, { logoUrl: tenant.logo_url, issuedOn: today, companyAddress: address }), { allowHosts: storageHost ? [storageHost] : [] });
  } catch (e) {
    console.error("[rfq] PDF render failed", e);
    return null;
  }
}

// ── Sending ─────────────────────────────────────────────────────────────────

export type SendKind = "request" | "reminder" | "message";

export type SendResult = { ok: true; to: string[]; redirected: boolean; via: "platform" | "mailbox" } | { ok: false; reason: string };

/** Sends one email to one RFQ recipient through the tenant's configured
 *  channel, ALWAYS via resolveOutbound(), and records it in the RFQ
 *  conversation and email_log. Request/reminder carry the Excel reply sheet. */
export async function sendToSupplier(admin: SupabaseClient, args: {
  tenant: Tenant;
  bundle: RfqBundle;
  rs: RfqSupplierRow;
  kind: SendKind;
  message?: string | null;
  attachments?: { filename: string; content: Buffer; contentType: string }[];
  /** The printable RFQ, rendered once by the caller for the whole send. */
  pdf?: Buffer | null;
  actor: { id: string | null; email: string | null };
}): Promise<SendResult> {
  const { tenant, bundle, rs, kind } = args;
  const tenantId = tenant.id;
  const cfg = rfqConfig(tenant.config?.rfq);
  const to = (rs.email_to || rs.suppliers?.email || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return { ok: false, reason: `${rs.suppliers?.name ?? "This supplier"} has no valid email address — add one, or share the link on WhatsApp.` };

  const view = await supplierViewFor(admin, tenant, bundle, rs);
  const expiresAt = linkExpiry(bundle.rfq.respond_by, cfg.link_grace_days);
  const link = replyLink(tenant, rs.id, rs.token_nonce, expiresAt);
  const code = mailCode(rs.id);
  const built = kind === "message"
    ? buildMessageEmail(view, code, args.message ?? "", link)
    : buildRequestEmail(view, { link, code, reminder: kind === "reminder", message: args.message });

  const routed = resolveOutbound(emailOutputFor(tenant), { to: [to], subject: built.subject, text: built.text, html: built.html });
  if (!routed.ok) return { ok: false, reason: routed.error };
  const mail = routed.email;

  const files: { filename: string; content: Buffer; contentType: string }[] = [...(args.attachments ?? [])];
  if (kind === "request" && args.pdf) {
    files.push({ filename: `${view.ref}.pdf`, content: args.pdf, contentType: "application/pdf" });
  }
  if (kind !== "message") {
    try {
      files.push({ filename: `${view.ref}-reply-sheet.xlsx`, content: await buildReplySheet(view), contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    } catch (e) {
      console.error("[rfq] reply sheet build failed", e);
    }
  }

  const fromName = view.buyerName ? `${view.buyerName} · ${tenant.name}` : tenant.name;
  const messageId = `<rfq.${rs.id}.${Date.now()}@${(process.env.RESEND_SENDING_DOMAIN || "bpmsquare.com")}>`;
  let via: "platform" | "mailbox" = cfg.mail_mode;
  let sendError: string | null = null;
  let fromAddress: string | null = null;

  if (cfg.mail_mode === "mailbox") {
    const mb = await loadMailbox(admin, tenantId, cfg.mailbox_connector);
    if (!mb) return { ok: false, reason: `RFQ email is set to go from your own mailbox, but the ${cfg.mailbox_connector === "gmail" ? "Gmail" : "Mail server"} connector isn't connected (Settings → Connectors).` };
    fromAddress = mb.address;
    const res = await sendViaMailbox(mb, {
      fromName, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html, messageId,
      attachments: files.map((f) => ({ filename: f.filename, content: f.content, contentType: f.contentType })),
    });
    if (!res.ok) sendError = res.error;
  } else {
    via = "platform";
    if (!process.env.RESEND_API_KEY) return { ok: false, reason: "Email sending isn't configured (missing RESEND_API_KEY)." };
    const sendingDomain = process.env.RESEND_SENDING_DOMAIN || "bpmsquare.com";
    const local = (tenant.slug || "rfq").toLowerCase().replace(/[^a-z0-9._-]/g, "");
    fromAddress = `${local}@${sendingDomain}`;
    const inboundDomain = process.env.INBOUND_EMAIL_DOMAIN?.trim().toLowerCase();
    const replyTo = (inboundDomain && replyToAddress(rs.id, inboundDomain)) || view.buyerEmail || tenant.company_info?.email || undefined;
    const resend = new Resend(process.env.RESEND_API_KEY);
    const result = await resend.emails.send({
      from: `${fromName} <${fromAddress}>`,
      to: mail.to,
      replyTo,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      headers: { "Message-ID": messageId },
      attachments: files.map((f) => ({ filename: f.filename, content: f.content })),
    });
    if (result.error) sendError = result.error.message;
  }

  const now = new Date().toISOString();
  await admin.from("rfq_messages").insert({
    tenant_id: tenantId, rfq_id: bundle.rfq.id, rfq_supplier_id: rs.id,
    direction: "out", channel: "email", from_address: fromAddress, to_addresses: mail.to,
    subject: mail.subject, body_text: kind === "message" ? (args.message ?? "").slice(0, 20000) : mail.text.slice(0, 20000),
    message_id: messageId, provider: via,
    attachments: files.map((f) => ({ path: "", filename: f.filename, content_type: f.contentType, size: f.content.length })),
    status: sendError ? "failed" : mail.redirected ? "redirected" : "sent",
    error: sendError, created_by: args.actor.id,
  });
  await logEmail(admin, {
    tenantId, kind: "rfq", toEmail: mail.to.join(", "), subject: mail.subject,
    status: sendError ? "failed" : "sent", error: sendError,
    relatedObjectType: "rfqs", relatedObjectId: bundle.rfq.id, relatedObjectLabel: bundle.rfq.ref,
    actorId: args.actor.id, actorEmail: args.actor.email,
  });
  if (sendError) return { ok: false, reason: `Send failed: ${sendError}` };

  const patch: Record<string, unknown> = { updated_at: now, link_expires_at: new Date(expiresAt).toISOString() };
  if (kind === "request") {
    patch.sent_at = now;
    if (rs.status === "pending" || rs.status === "expired") patch.status = "sent";
  } else if (kind === "reminder") {
    patch.reminder_count = (rs.reminder_count ?? 0) + 1;
    patch.last_reminded_at = now;
  }
  await admin.from("rfq_suppliers").update(patch).eq("id", rs.id).eq("tenant_id", tenantId);
  if (kind === "request" && bundle.rfq.status === "draft") {
    await admin.from("rfqs").update({ status: "sent", updated_at: now }).eq("id", bundle.rfq.id).eq("tenant_id", tenantId);
  }
  return { ok: true, to: mail.to, redirected: mail.redirected, via };
}

// ── Replies ─────────────────────────────────────────────────────────────────

/** Store one supplier's answers (from the link, the buyer's grid, an
 *  uploaded sheet or a parsed email) and move the recipient to replied. Line
 *  ids are re-verified against THIS rfq -- never trusted from the caller. */
export async function saveResponses(admin: SupabaseClient, args: {
  tenantId: string;
  rfqId: string;
  rs: Pick<RfqSupplierRow, "id" | "status" | "currency">;
  rows: CleanResponse[];
  source: "link" | "buyer" | "upload" | "email";
  header?: { supplier_quote_ref?: string | null; currency?: string | null; incoterm?: string | null; freight_amount?: number | null; payment_terms?: string | null; valid_until?: string | null; note?: string | null };
  declined?: boolean;
}): Promise<{ saved: number }> {
  const { tenantId, rfqId, rs } = args;
  const { data: lineRows } = await admin.from("rfq_lines").select("id, status").eq("tenant_id", tenantId).eq("rfq_id", rfqId);
  const live = new Set(((lineRows ?? []) as { id: string; status: string }[]).filter((l) => l.status !== "cancelled").map((l) => l.id));
  const now = new Date().toISOString();
  const headerCurrency = args.header?.currency ?? rs.currency ?? null;
  const rows = args.rows.filter((r) => live.has(r.rfq_line_id)).map((r) => ({
    tenant_id: tenantId, rfq_supplier_id: rs.id, rfq_line_id: r.rfq_line_id, status: r.status,
    unit_price: r.unit_price, currency: r.currency ?? headerCurrency, lead_time_days: r.lead_time_days, moq: r.moq,
    offered_description: r.offered_description, valid_until: r.valid_until ?? args.header?.valid_until ?? null, note: r.note,
    source: args.source, submitted_at: now, updated_at: now,
  }));
  if (rows.length) {
    const { error } = await admin.from("rfq_responses").upsert(rows, { onConflict: "rfq_supplier_id,rfq_line_id" });
    if (error) throw { status: 500, message: error.message };
  }
  const patch: Record<string, unknown> = { updated_at: now };
  if (args.header) {
    for (const k of ["supplier_quote_ref", "currency", "incoterm", "freight_amount", "payment_terms", "valid_until", "note"] as const) {
      if (args.header[k] !== undefined) patch[k] = args.header[k];
    }
  }
  if (args.declined) {
    patch.status = "declined";
    patch.replied_at = now;
    patch.reply_source = args.source;
  } else if (rows.length) {
    patch.status = "replied";
    patch.replied_at = now;
    patch.reply_source = args.source;
  }
  await admin.from("rfq_suppliers").update(patch).eq("id", rs.id).eq("tenant_id", tenantId);
  await refreshRfqStatus(admin, tenantId, rfqId);
  return { saved: rows.length };
}

// ── Attachments ─────────────────────────────────────────────────────────────

/** Stores one file in the private bucket under {tenant}/rfq/{rfq}/…, with
 *  the extension derived from the validated MIME type, never the filename
 *  (2026-07-25 audit). Returns null for a type we don't keep. */
export async function storeAttachment(admin: SupabaseClient, tenantId: string, rfqId: string, file: { filename: string; contentType: string; content: Buffer }): Promise<RfqAttachment | null> {
  const type = file.contentType.split(";")[0].trim().toLowerCase();
  const ext = RFQ_ATTACHMENT_TYPES[type];
  if (!ext || file.content.length === 0 || file.content.length > RFQ_LIMITS.maxAttachmentBytes) return null;
  const path = `${tenantId}/rfq/${rfqId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await admin.storage.from(ATTACHMENT_BUCKET).upload(path, file.content, { contentType: type, upsert: false });
  if (error) {
    console.error("[rfq] attachment upload failed", error.message);
    return null;
  }
  const filename = file.filename.replace(/[\\/\r\n"]/g, "_").slice(0, 160) || `file.${ext}`;
  return { path, filename, content_type: type, size: file.content.length };
}

// ── Award ───────────────────────────────────────────────────────────────────

const DEFAULT_COST_VALIDITY_DAYS = 180;

/**
 * Award one line to one response (or mark it no-award with responseId null).
 * A supplier price is a COST, never a sell price: for a catalog-product line
 * the award writes one confirmed, product-scoped pricing_cost_inputs row
 * (source RFQ) that the pricing engine's ladder finds on the next Price, as
 * the legacy reply did. Only the AWARDED response writes, which is what ends
 * the old same-day collision between two suppliers' replies.
 */
export async function awardLine(admin: SupabaseClient, ctx: { tenantId: string; userId: string; email: string | null }, args: {
  rfq: Rfq; lineId: string; responseId: string | null; fxRate?: number | null;
}): Promise<{ status: "awarded" | "no_award"; cost_input_id: string | null; unit_cost: number | null; warning?: string }> {
  const { tenantId } = ctx;
  const { data: line } = await admin.from("rfq_lines").select("*").eq("id", args.lineId).eq("tenant_id", tenantId).eq("rfq_id", args.rfq.id).maybeSingle();
  if (!line) throw { status: 404, message: "Line not found" };
  const now = new Date().toISOString();

  // Clear any earlier award on this line first.
  const { data: sups } = await admin.from("rfq_suppliers").select("id").eq("tenant_id", tenantId).eq("rfq_id", args.rfq.id);
  const supIds = ((sups ?? []) as { id: string }[]).map((s) => s.id);
  if (supIds.length) {
    await admin.from("rfq_responses").update({ is_awarded: false, updated_at: now }).eq("tenant_id", tenantId).eq("rfq_line_id", args.lineId).in("rfq_supplier_id", supIds);
  }

  if (!args.responseId) {
    await admin.from("rfq_lines").update({ status: "no_award", awarded_response_id: null, awarded_unit_cost: null, updated_at: now }).eq("id", args.lineId).eq("tenant_id", tenantId);
    await refreshRfqStatus(admin, tenantId, args.rfq.id);
    await logChange(admin, { tenantId, objectType: "rfqs", objectId: args.rfq.id, objectLabel: args.rfq.ref, action: "update", actorId: ctx.userId, actorEmail: ctx.email, changes: [{ field: `line ${line.sl_no}`, from: line.status, to: "no_award" }] });
    return { status: "no_award", cost_input_id: null, unit_cost: null };
  }

  const { data: resp } = await admin.from("rfq_responses").select("*, rfq_suppliers(id, supplier_id, suppliers(name))")
    .eq("id", args.responseId).eq("tenant_id", tenantId).eq("rfq_line_id", args.lineId).maybeSingle();
  if (!resp || !supIds.includes(resp.rfq_supplier_id as string)) throw { status: 404, message: "Response not found on this line" };
  if (resp.status === "no_quote" || resp.unit_price === null) throw { status: 422, message: "That supplier didn't quote this line." };

  const fx = args.fxRate !== undefined && args.fxRate !== null ? Number(args.fxRate) : resp.fx_rate !== null ? Number(resp.fx_rate) : 1;
  if (!Number.isFinite(fx) || fx <= 0 || fx > 1e6) throw { status: 422, message: "Exchange rate must be a positive number." };
  const unitCost = Math.round(Number(resp.unit_price) * fx * 10000) / 10000;

  let costInputId: string | null = null;
  let warning: string | undefined;
  if (line.product_id) {
    const today = await tenantToday(tenantId);
    const validTo = (resp.valid_until as string | null) && (resp.valid_until as string) >= today
      ? (resp.valid_until as string)
      : addDays(today, DEFAULT_COST_VALIDITY_DAYS);
    const input = {
      tenant_id: tenantId, cost_model_code: line.cost_model_code || "STANDARD_COST", path: line.path || "purchase.unit_cost", kind: "PURCHASE",
      value: unitCost, uom: line.uom ?? null, currency: null, valid_from: today, valid_to: validTo,
      source: "MANUAL", created_by: ctx.userId, source_code: "RFQ", quality: "confirmed", as_of: today, product_id: line.product_id,
    };
    const { data: ci, error: ciErr } = await admin.from("pricing_cost_inputs")
      .upsert(input, { onConflict: "tenant_id,cost_model_code,path,source_key,product_key,valid_from_key" })
      .select("id").single();
    if (ciErr) {
      // Pricing tables absent or the PURCHASE kind not migrated: the award
      // still stands on the RFQ, it just can't feed the engine yet.
      warning = `Awarded, but the cost couldn't be recorded for pricing: ${ciErr.message}`;
    } else {
      costInputId = ci.id as string;
    }
  }

  await admin.from("rfq_responses").update({ is_awarded: true, fx_rate: fx, updated_at: now }).eq("id", args.responseId).eq("tenant_id", tenantId);
  await admin.from("rfq_lines").update({
    status: "awarded", awarded_response_id: args.responseId, awarded_unit_cost: unitCost,
    cost_input_id: costInputId ?? line.cost_input_id ?? null, updated_at: now,
  }).eq("id", args.lineId).eq("tenant_id", tenantId);
  await refreshRfqStatus(admin, tenantId, args.rfq.id);

  const supplierName = (resp as unknown as { rfq_suppliers?: { suppliers?: { name?: string } } }).rfq_suppliers?.suppliers?.name ?? "supplier";
  await logChange(admin, {
    tenantId, objectType: "rfqs", objectId: args.rfq.id, objectLabel: args.rfq.ref, action: "update", actorId: ctx.userId, actorEmail: ctx.email,
    changes: [{ field: `line ${line.sl_no} awarded`, from: null, to: `${supplierName} @ ${resp.unit_price}${resp.currency ? " " + resp.currency : ""}${fx !== 1 ? ` × ${fx}` : ""}` }],
  });
  return { status: "awarded", cost_input_id: costInputId, unit_cost: unitCost, warning };
}

// ── Internal notifications ─────────────────────────────────────────────────

/** Tells the requester and buyer that something happened on their RFQ. An
 *  internal email, still through resolveOutbound() like every other send. */
export async function notifyRfqTeam(admin: SupabaseClient, tenant: Tenant, rfq: Pick<Rfq, "id" | "ref" | "title" | "requested_by" | "buyer_id">, summary: string): Promise<void> {
  try {
    if (!process.env.RESEND_API_KEY) return;
    const ids = [...new Set([rfq.requested_by, rfq.buyer_id].filter((x): x is string => !!x))];
    const emails: string[] = [];
    for (const id of ids) {
      const { data } = await admin.auth.admin.getUserById(id).catch(() => ({ data: null }));
      if (data?.user?.email) emails.push(data.user.email);
    }
    if (!emails.length) return;
    const link = `${tenantOrigin(tenant.custom_domain)}/rfqs/${rfq.id}`;
    const subject = `${rfq.ref}: ${summary}`.slice(0, 200);
    const text = `${summary}\n\n${rfq.ref} — ${rfq.title}\nOpen it: ${link}`;
    const routed = resolveOutbound(emailOutputFor(tenant), { to: emails, subject, text });
    if (!routed.ok) return;
    const sendingDomain = process.env.RESEND_SENDING_DOMAIN || "bpmsquare.com";
    await new Resend(process.env.RESEND_API_KEY).emails.send({
      from: `BPMSquare <notifications@${sendingDomain}>`, to: routed.email.to, subject: routed.email.subject, text: routed.email.text,
    });
  } catch (e) {
    console.error("[rfq] team notification failed", e);
  }
}

/** Loads the full tenant row by id -- inbound mail and the cron have no
 *  request host to resolve it from. */
export async function loadTenantById(admin: SupabaseClient, tenantId: string): Promise<Tenant | null> {
  const { data } = await admin.from("tenants")
    .select("id, slug, name, logo_url, accent_color, status, plan, features, company_info, config, custom_domain, api_key, is_demo")
    .eq("id", tenantId).maybeSingle();
  return (data as Tenant | null) ?? null;
}
