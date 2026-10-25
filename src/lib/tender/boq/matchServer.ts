import "server-only";
import { getAuthUser } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";
import { logChange } from "@/lib/changeLog";
import { fetchAllRows } from "@/lib/import/server";
import { loadOpportunityLines } from "@/lib/sales/opportunityServer";
import { linesVersion } from "@/lib/sales/dealLines";
import { bundles, type BoqRequest, type Failure } from "./server";
import { createMatcher, type MatchProduct, type Suggestion } from "./match";

// Server side of "Match to products" on a tender deal's BOQ (see match.ts for the scoring). BOQ lines are created as free text;
// this links a line to a catalog product so the BOM and supplier price sources can find it. Only `product_id` is ever written to a
// deal line: the client's own description and unit stay on the line and in the BOQ. The workspace and the deal come from
// openBoqRequest(); a product id from the request is checked against THIS workspace before it is used, and the list a person
// decided from carries the lines fingerprint, so a list that went stale (the BOQ or the Lines tab changed the lines) is refused.
// Cost data is not selected anywhere in this file: the match list shows name, SKU and unit only.

const UUID = /^[0-9a-f-]{36}$/i;
const MAX_LINKS = 500;

export type SuggestionView = Suggestion & { name: string; sku: string | null; uom: string | null };
export type MatchRow = { boq_id: string; item_no: string | null; description: string; cost_code: string | null; uom: string | null; qty: number; suggestions: SuggestionView[] };
export type MatchState = {
  /** False when the workspace has no Products module: there is no catalog to match against. */
  enabled: boolean;
  lines_version: string;
  rows: MatchRow[];
  /** Lines whose best suggestion is strong and unambiguous: what "Accept strong matches" would link. */
  strong: number;
};
export type ProductHit = { id: string; name: string; sku: string | null; uom: string | null };

type ProductRow = { id: string; name: string | null; sku: string | null; uom: string | null; status?: string | null };
const toProduct = (p: ProductRow): MatchProduct => ({ id: p.id, name: p.name ?? "", sku: p.sku ?? null, uom: p.uom ?? null });

async function productsEnabled(r: BoqRequest): Promise<boolean> {
  return tenantHasFeature(r.supabase, r.tenantId, "products");
}

async function loadCatalog(r: BoqRequest): Promise<MatchProduct[]> {
  const rows = await fetchAllRows<ProductRow>(r.admin, "products", "id, name, sku, uom, status", r.tenantId);
  return rows.filter((p) => p.status !== "inactive").map(toProduct);
}

/** The top suggestion when it is strong and nothing else ties it; otherwise null. This is the only thing "accept strong" links. */
function unambiguousStrong(s: readonly Suggestion[]): Suggestion | null {
  if (s.length === 0 || s[0].band !== "strong") return null;
  return s[1] && s[1].score === s[0].score ? null : s[0];
}

export async function buildMatchState(r: BoqRequest): Promise<MatchState> {
  const empty: MatchState = { enabled: false, lines_version: "", rows: [], strong: 0 };
  if (!(await productsEnabled(r))) return empty;
  const [b, lines, catalog] = await Promise.all([bundles(r), loadOpportunityLines(r.admin, r.tenantId, r.opp.id), loadCatalog(r)]);
  const version = linesVersion(lines);
  if (!b) return { ...empty, enabled: true, lines_version: version };
  const byId = new Map(catalog.map((p) => [p.id, p]));
  const match = createMatcher(catalog);
  let strong = 0;
  const rows: MatchRow[] = b.items.filter((x) => !x.line.product_id).map((x) => {
    const found = match({ description: x.line.description, cost_code: x.boq.cost_code, uom: x.boq.file_uom ?? x.line.uom }, 3);
    if (unambiguousStrong(found)) strong++;
    return {
      boq_id: x.boq.id, item_no: x.boq.item_no, description: x.line.description, cost_code: x.boq.cost_code, uom: x.boq.file_uom ?? x.line.uom ?? null, qty: Number(x.line.qty),
      suggestions: found.map((s) => ({ ...s, name: byId.get(s.product_id)!.name, sku: byId.get(s.product_id)!.sku, uom: byId.get(s.product_id)!.uom })),
    };
  });
  return { enabled: true, lines_version: version, rows, strong };
}

/** A search box over the workspace's products: name or SKU, ten at most, name / SKU / unit only. */
export async function searchProducts(r: BoqRequest, q: string): Promise<ProductHit[]> {
  if (!(await productsEnabled(r))) return [];
  // The characters that would break out of the filter expression (and the LIKE wildcards) are not part of a name worth searching.
  const term = q.replace(/[%_*\\,()"']/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  if (term.length < 2) return [];
  const { data, error } = await r.admin.from("products").select("id, name, sku, uom, status").eq("tenant_id", r.tenantId).or(`name.ilike.%${term}%,sku.ilike.%${term}%`).limit(25);
  if (error) return [];
  return ((data ?? []) as ProductRow[]).filter((p) => p.status !== "inactive").slice(0, 10).map((p) => ({ id: p.id, name: p.name ?? "", sku: p.sku ?? null, uom: p.uom ?? null }));
}

export type LinkBody = { base_version?: unknown; links?: unknown; accept_strong?: unknown };
export type LinkResult =
  | { ok: true; linked: number; skipped: number; lines_version: string }
  | ({ ok: false } & Failure & { code?: string });

/** Link BOQ lines to products. Everything is checked before the first write: the version, each line, each product. */
export async function linkProducts(r: BoqRequest, body: LinkBody): Promise<LinkResult> {
  const { admin, tenantId, opp } = r;
  if (!(await productsEnabled(r))) return { ok: false, status: 404, error: "Not found" };
  const base = typeof body.base_version === "string" ? body.base_version : "";
  if (!base) return { ok: false, status: 422, error: "Reload the list and try again" };

  const lines = await loadOpportunityLines(admin, tenantId, opp.id);
  if (base !== linesVersion(lines)) {
    return { ok: false, status: 409, code: "lines_changed", error: "The lines of this deal changed since this list was loaded. The list has been reloaded; check it and accept again." };
  }
  const b = await bundles(r);
  if (!b) return { ok: false, status: 404, error: "Line not found" };
  const byBoq = new Map(b.items.map((x) => [x.boq.id, x]));

  const wanted: { boqId: string; productId: string }[] = [];
  if (body.accept_strong === true) {
    const catalog = await loadCatalog(r);
    const match = createMatcher(catalog);
    for (const x of b.items) {
      if (x.line.product_id) continue;
      const top = unambiguousStrong(match({ description: x.line.description, cost_code: x.boq.cost_code, uom: x.boq.file_uom ?? x.line.uom }, 3));
      if (top) wanted.push({ boqId: x.boq.id, productId: top.product_id });
    }
  } else if (Array.isArray(body.links)) {
    if (body.links.length > MAX_LINKS) return { ok: false, status: 422, error: `Link at most ${MAX_LINKS} lines at a time` };
    for (const raw of body.links as Record<string, unknown>[]) {
      const boqId = typeof raw?.line === "string" ? raw.line : "";
      const productId = typeof raw?.product_id === "string" ? raw.product_id : "";
      if (!UUID.test(boqId) || !byBoq.has(boqId)) return { ok: false, status: 404, error: "Line not found" };
      if (!UUID.test(productId)) return { ok: false, status: 404, error: "Product not found" };
      wanted.push({ boqId, productId });
    }
  } else {
    return { ok: false, status: 422, error: "Nothing to link" };
  }

  // One entry per line (the last choice wins); a line that already has a product is left alone.
  const choice = new Map(wanted.map((w) => [w.boqId, w.productId]));
  let skipped = 0;
  const todo: { boqId: string; productId: string }[] = [];
  for (const [boqId, productId] of choice) {
    if (byBoq.get(boqId)!.line.product_id) { skipped++; continue; }
    todo.push({ boqId, productId });
  }
  if (todo.length === 0) return { ok: true, linked: 0, skipped, lines_version: base };

  // The product must be one of THIS workspace's: a foreign or unknown id is a 404 and nothing is written.
  const ids = [...new Set(todo.map((t) => t.productId))];
  const found = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await admin.from("products").select("id, name").eq("tenant_id", tenantId).in("id", ids.slice(i, i + 100));
    if (error) return { ok: false, status: 500, error: error.message };
    for (const p of (data ?? []) as { id: string; name: string | null }[]) found.set(p.id, p.name ?? "");
  }
  if (ids.some((id) => !found.has(id))) return { ok: false, status: 404, error: "Product not found" };

  for (let i = 0; i < todo.length; i += 20) {
    const results = await Promise.all(todo.slice(i, i + 20).map((t) =>
      admin.from("opportunity_lines").update({ product_id: t.productId }).eq("id", byBoq.get(t.boqId)!.line.id).eq("tenant_id", tenantId).eq("opportunity_id", opp.id)));
    const failed = results.find((x) => x.error);
    if (failed?.error) return { ok: false, status: 500, error: failed.error.message };
  }

  const user = await getAuthUser();
  await logChange(r.supabase, {
    tenantId, objectType: "opportunity_tenders", objectId: opp.id, objectLabel: `${opp.ref ?? ""} ${opp.title}`.trim(), action: "update", actorId: user?.id, actorEmail: user?.email,
    changes: todo.slice(0, 50).map((t) => { const x = byBoq.get(t.boqId)!; return { field: `BOQ product ${x.boq.item_no ?? `row ${x.boq.row_no}`}`, from: null, to: found.get(t.productId) ?? "" }; }),
  });
  return { ok: true, linked: todo.length, skipped, lines_version: linesVersion(await loadOpportunityLines(admin, tenantId, opp.id)) };
}
