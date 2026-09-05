import "server-only";
import { createAdminSupabase } from "@/lib/supabase-server";
import {
  priceDocument, PricingError,
  type PriceInput, type PriceResult, type PriceComponent, type PricingProcedure,
  type PriceRule, type DimensionRegistry, type CostModel, type CostInput, type ProcedureStep,
  type CostSourceDef, type CostCandidate,
} from "@/lib/pricing-core";
import { buildPricingDocumentRow, type PricingCallMeta, type PricingDocumentRow, type PricingDocumentSource } from "./documents";
import { productCostCandidate, PURCHASE_PATH } from "./costSheet";

// Persistence adapter for the pricing engine (spec §11.1): the ONLY place
// that maps ontology tables into the pure core's types. The core never sees
// a database; this file never computes a price. Every query is explicitly
// tenant-filtered on the admin client per MULTI_TENANT_GUARDRAILS.

export type LoadedConfig = {
  version: number;
  dsl_version: number;
  procedures: (PricingProcedure & { code: string })[];
  components: PriceComponent[];
  rules: PriceRule[];
  cost_models: CostModel[];
  registry: DimensionRegistry;
};

export class PricingConfigError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "PricingConfigError";
  }
}

/**
 * Load a tenant's pricing configuration: the PUBLISHED version by default,
 * or an explicitly requested version (for replay/simulation). Cost inputs are
 * loaded regardless of version — they resolve by effective date only (§3).
 */
export async function loadPricingConfig(
  tenantId: string,
  opts: { pricingArea?: string; configVersion?: number } = {}
): Promise<LoadedConfig> {
  const admin = createAdminSupabase();
  const area = opts.pricingArea ?? "default";

  let version = opts.configVersion;
  let dslVersion = 1;
  if (version === undefined) {
    const { data: published } = await admin
      .from("pricing_config_versions")
      .select("version, dsl_version")
      .eq("tenant_id", tenantId)
      .eq("pricing_area", area)
      .eq("status", "PUBLISHED")
      .maybeSingle();
    if (!published) {
      throw new PricingConfigError(409, `No PUBLISHED pricing configuration for area "${area}". Publish a config version first.`);
    }
    version = published.version as number;
    dslVersion = (published.dsl_version as number) ?? 1;
  } else {
    const { data: row } = await admin
      .from("pricing_config_versions")
      .select("version, dsl_version")
      .eq("tenant_id", tenantId)
      .eq("pricing_area", area)
      .eq("version", version)
      .maybeSingle();
    if (!row) throw new PricingConfigError(404, `Pricing config version ${version} not found for area "${area}".`);
    dslVersion = (row.dsl_version as number) ?? 1;
  }

  const [{ data: procedures }, { data: components }, { data: rules }, { data: dimensions }, { data: models }, { data: inputs }] =
    await Promise.all([
      admin.from("pricing_procedures").select("code, name, entry_mode, steps").eq("tenant_id", tenantId).eq("config_version", version),
      admin.from("pricing_components").select("*").eq("tenant_id", tenantId).eq("config_version", version),
      admin.from("pricing_rules").select("*").eq("tenant_id", tenantId).eq("config_version", version),
      admin.from("pricing_dimensions").select("attribute, weight").eq("tenant_id", tenantId),
      admin.from("pricing_cost_models").select("code, name, sources").eq("tenant_id", tenantId).eq("config_version", version),
      // Tenant-wide rates only. Product-specific figures (an RFQ reply, an
      // imported price-list cost) are line candidates -- see productCostCandidates.
      admin.from("pricing_cost_inputs").select("*").eq("tenant_id", tenantId).is("product_id", null),
    ]);

  const registry: DimensionRegistry = {};
  for (const d of dimensions ?? []) registry[d.attribute as string] = Number(d.weight);

  const inputsByModel = new Map<string, CostInput[]>();
  for (const i of inputs ?? []) {
    const list = inputsByModel.get(i.cost_model_code as string) ?? [];
    list.push(mapCostInput(i));
    inputsByModel.set(i.cost_model_code as string, list);
  }

  return {
    version,
    dsl_version: dslVersion,
    procedures: (procedures ?? []).map((p) => ({
      procedure_id: p.code as string,
      code: p.code as string,
      entry_mode: p.entry_mode as PricingProcedure["entry_mode"],
      steps: (p.steps ?? []) as ProcedureStep[],
    })),
    components: (components ?? []).map((c) => ({
      code: c.code as string,
      name: c.name as string,
      class: c.class as PriceComponent["class"],
      calc_type: c.calc_type as PriceComponent["calc_type"],
      calc_basis: c.calc_basis as PriceComponent["calc_basis"],
      sign: c.sign as PriceComponent["sign"],
      rounding_rule: (c.rounding_rule as PriceComponent["rounding_rule"]) ?? null,
      manual_override: c.manual_override as PriceComponent["manual_override"],
      is_statistical: Boolean(c.is_statistical),
      resolution_strategy: c.resolution_strategy as PriceComponent["resolution_strategy"],
    })),
    rules: (rules ?? []).map((r) => ({
      rule_id: r.id as string,
      component_code: r.component_code as string,
      match_attributes: (r.match_attributes ?? {}) as PriceRule["match_attributes"],
      value: r.value === null || r.value === undefined ? null : Number(r.value),
      scale: (r.scale as PriceRule["scale"]) ?? null,
      formula: (r.formula as string) ?? null,
      currency: (r.currency as string) ?? null,
      uom: (r.uom as string) ?? null,
      valid_from: (r.valid_from as string) ?? null,
      valid_to: (r.valid_to as string) ?? null,
      created_at: (r.created_at as string) ?? null,
    })),
    cost_models: (models ?? []).map((m) => ({
      code: m.code as string,
      name: m.name as string,
      inputs: inputsByModel.get(m.code as string) ?? [],
      sources: Array.isArray(m.sources) ? (m.sources as CostSourceDef[]) : null,
    })),
    registry,
  };
}

function mapCostInput(i: Record<string, unknown>): CostInput {
  return {
    path: i.path as string,
    kind: i.kind as CostInput["kind"],
    value: Number(i.value),
    uom: (i.uom as string) ?? null,
    currency: (i.currency as string) ?? null,
    valid_from: (i.valid_from as string) ?? null,
    valid_to: (i.valid_to as string) ?? null,
    source: (i.source_code as string) ?? null,
    quality: (i.quality as CostInput["quality"]) ?? null,
    as_of: (i.as_of as string) ?? null,
  };
}

/**
 * A product's own cost figures, keyed by path, for the ladder: its ERP cost
 * price (source PRODUCT_COST, quality actual, dated by cost_price_as_of) and
 * every product-scoped cost input on file (RFQ replies, imported price-list
 * costs). Tenant-scoped on both reads.
 */
export async function productCostCandidates(tenantId: string, productId: string): Promise<{
  product: { id: string; name: string; cost_sheet: unknown; cost_price: number | null; cost_price_as_of: string | null; updated_at: string | null; category: string | null; sub_category: string | null } | null;
  candidates: Record<string, CostCandidate[]>;
}> {
  const admin = createAdminSupabase();
  const [{ data: product }, { data: inputs }] = await Promise.all([
    admin.from("products").select("id, name, cost_sheet, cost_price, cost_price_as_of, updated_at, category, sub_category")
      .eq("id", productId).eq("tenant_id", tenantId).maybeSingle(),
    admin.from("pricing_cost_inputs").select("*").eq("tenant_id", tenantId).eq("product_id", productId),
  ]);
  if (!product) return { product: null, candidates: {} };
  const candidates: Record<string, CostCandidate[]> = {};
  const own = productCostCandidate(product as { cost_price?: number | null; cost_price_as_of?: string | null; updated_at?: string | null });
  if (own) (candidates[PURCHASE_PATH] ??= []).push(own);
  for (const i of inputs ?? []) {
    const c = mapCostInput(i as Record<string, unknown>);
    (candidates[c.path] ??= []).push({ ...c, path: c.path });
  }
  return { product: product as never, candidates };
}

/** The cost step could not find a figure: the NEEDS_RFQ moment. */
export function isNeedsCost(e: unknown): e is PricingError {
  return e instanceof PricingError && (e.code === "NO_RATE_IN_FORCE" || e.code === "COST_MISSING");
}

export type PriceCallResult = {
  result: PriceResult; config_version: number; procedure: string; calc_ms: number;
  /** The stored pricing_documents row, when the store succeeded (null while
   *  migration 0111 is pending or the insert failed -- pricing itself never
   *  fails because the record could not be kept). */
  document_id: string | null;
};

export type RunPriceOptions = {
  pricingDate?: string; configVersion?: number; pricingArea?: string; procedure?: string; currency?: string;
  /** Provenance for the stored context. Defaults to an anonymous API call. */
  meta?: PricingCallMeta;
};

/**
 * Load config + execute one pricing call. Procedure selection: the named one,
 * or the version's only procedure when exactly one exists. Every call is
 * stored in pricing_documents (spec §7: full contexts, not reconstructions)
 * and metered in pricing_usage.
 */
export async function runPrice(
  tenantId: string,
  document: PriceInput["document"],
  opts: RunPriceOptions = {}
): Promise<PriceCallResult> {
  const config = await loadPricingConfig(tenantId, { pricingArea: opts.pricingArea, configVersion: opts.configVersion });

  let procedure = opts.procedure
    ? config.procedures.find((p) => p.code === opts.procedure)
    : config.procedures.length === 1
      ? config.procedures[0]
      : undefined;
  if (!procedure) {
    const available = config.procedures.map((p) => p.code).join(", ") || "(none defined)";
    throw new PricingConfigError(422, opts.procedure
      ? `Procedure "${opts.procedure}" not found in config version ${config.version}. Available: ${available}`
      : `This config version has ${config.procedures.length} procedures — name one via options.procedure. Available: ${available}`);
  }

  const pricingDate = opts.pricingDate ?? new Date().toISOString().slice(0, 10);

  const started = Date.now();
  const result = priceDocument({
    procedure,
    components: config.components,
    rules: config.rules,
    cost_models: config.cost_models,
    registry: config.registry,
    document,
    pricing_date: pricingDate,
    currency: opts.currency,
  });
  const calc_ms = Date.now() - started;

  const admin = createAdminSupabase();
  const meta: PricingCallMeta = opts.meta ?? { source: "api" };
  const area = opts.pricingArea ?? "default";

  // Store the context (spec §7). Best-effort so a storage problem never
  // turns into a wrong or missing price, but LOUD: a silent gap here would
  // quietly hollow out simulation and analysis.
  let document_id: string | null = null;
  try {
    const row = buildPricingDocumentRow({
      tenantId, area, configVersion: config.version, procedure: procedure.code,
      document, result, calcMs: calc_ms, meta,
    });
    const { data, error } = await admin.from("pricing_documents").insert(row).select("id").single();
    if (error) console.error("pricing_documents insert failed:", error.message);
    else document_id = data.id as string;
  } catch (e) {
    console.error("pricing_documents insert threw:", e);
  }

  // Metering (spec §15.4): one row per call — billing meter and rate-limit
  // basis in one mechanism. Best-effort: never fails the pricing call, and
  // silently no-ops until migration 0084 is applied.
  try {
    await admin.from("pricing_usage").insert({
      tenant_id: tenantId,
      calls: 1,
      lines: document.lines.length,
      calc_ms,
      config_version: config.version,
      procedure: procedure.code,
      api_key_id: meta.apiKeyId ?? null,
      document_id,
    });
  } catch { /* metering must never break pricing */ }

  return { result, config_version: config.version, procedure: procedure.code, calc_ms, document_id };
}

// ── Stored documents ────────────────────────────────────────────────────────

export type StoredPricingDocument = PricingDocumentRow & { id: string; created_at: string };

/** One stored document, tenant-scoped. null when it does not exist (or the
 *  table does not yet -- migration 0111 pending reads as "no documents"). */
export async function loadPricingDocument(tenantId: string, documentId: string): Promise<StoredPricingDocument | null> {
  const { data } = await createAdminSupabase()
    .from("pricing_documents").select("*")
    .eq("tenant_id", tenantId).eq("id", documentId)
    .maybeSingle();
  return (data as StoredPricingDocument | null) ?? null;
}

export type PricingDocumentSummary = {
  id: string; pricing_area: string; config_version: number; procedure: string; pricing_date: string;
  source: PricingDocumentSource; source_id: string | null; replay_of: string | null;
  currency: string | null; net_total: number; line_count: number; calc_ms: number | null; created_at: string;
};

/** Recent documents for the cockpit and (batch 4) simulation. Never the
 *  full context -- that is one fetch per document on demand. */
export async function listPricingDocuments(
  tenantId: string,
  opts: { area?: string; limit?: number; source?: PricingDocumentSource } = {}
): Promise<PricingDocumentSummary[]> {
  let q = createAdminSupabase()
    .from("pricing_documents")
    .select("id, pricing_area, config_version, procedure, pricing_date, source, source_id, replay_of, currency, net_total, line_count, calc_ms, created_at")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(Math.min(200, Math.max(1, opts.limit ?? 50)));
  if (opts.area) q = q.eq("pricing_area", opts.area);
  if (opts.source) q = q.eq("source", opts.source);
  const { data, error } = await q;
  // 42P01 = relation does not exist: the migration is pending. Empty, not a crash.
  if (error) return [];
  return (data ?? []) as PricingDocumentSummary[];
}

/**
 * Replay a stored document: the same context against the same version and
 * pricing date (or a different version, for "what would this cost under my
 * draft" -- the seed of batch 4's simulation). The replay is itself stored,
 * linked back to the original, so a customer-facing "why" can always point
 * at the exact run that produced a number.
 */
export async function replayPricingDocument(
  tenantId: string,
  documentId: string,
  opts: { configVersion?: number; pricingDate?: string; meta?: Omit<PricingCallMeta, "replayOf"> } = {}
): Promise<PriceCallResult> {
  const doc = await loadPricingDocument(tenantId, documentId);
  if (!doc) throw new PricingConfigError(404, "Pricing document not found.");
  const meta: PricingCallMeta = { ...(opts.meta ?? { source: "test" }), replayOf: doc.id };
  return runPrice(tenantId, doc.context, {
    pricingArea: doc.pricing_area,
    configVersion: opts.configVersion ?? doc.config_version,
    procedure: doc.procedure,
    pricingDate: opts.pricingDate ?? doc.pricing_date,
    currency: doc.currency ?? undefined,
    meta,
  });
}

export { PricingError };
