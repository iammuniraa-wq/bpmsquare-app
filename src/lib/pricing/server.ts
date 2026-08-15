import "server-only";
import { createAdminSupabase } from "@/lib/supabase-server";
import {
  priceDocument, PricingError,
  type PriceInput, type PriceResult, type PriceComponent, type PricingProcedure,
  type PriceRule, type DimensionRegistry, type CostModel, type CostInput, type ProcedureStep,
} from "@/lib/pricing-core";

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
      admin.from("pricing_cost_models").select("code, name").eq("tenant_id", tenantId).eq("config_version", version),
      admin.from("pricing_cost_inputs").select("*").eq("tenant_id", tenantId),
    ]);

  const registry: DimensionRegistry = {};
  for (const d of dimensions ?? []) registry[d.attribute as string] = Number(d.weight);

  const inputsByModel = new Map<string, CostInput[]>();
  for (const i of inputs ?? []) {
    const list = inputsByModel.get(i.cost_model_code as string) ?? [];
    list.push({
      path: i.path as string,
      kind: i.kind as CostInput["kind"],
      value: Number(i.value),
      uom: (i.uom as string) ?? null,
      currency: (i.currency as string) ?? null,
      valid_from: (i.valid_from as string) ?? null,
      valid_to: (i.valid_to as string) ?? null,
    });
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
    })),
    registry,
  };
}

export type PriceCallResult = { result: PriceResult; config_version: number; procedure: string; calc_ms: number };

/**
 * Load config + execute one pricing call. Procedure selection: the named one,
 * or the version's only procedure when exactly one exists.
 */
export async function runPrice(
  tenantId: string,
  document: PriceInput["document"],
  opts: { pricingDate?: string; configVersion?: number; pricingArea?: string; procedure?: string; currency?: string } = {}
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

  // Metering (spec §15.4): one row per call — billing meter and rate-limit
  // basis in one mechanism. Best-effort: never fails the pricing call, and
  // silently no-ops until migration 0084 is applied.
  try {
    await createAdminSupabase().from("pricing_usage").insert({
      tenant_id: tenantId,
      calls: 1,
      lines: document.lines.length,
      calc_ms,
      config_version: config.version,
      procedure: procedure.code,
    });
  } catch { /* metering must never break pricing */ }

  return { result, config_version: config.version, procedure: procedure.code, calc_ms };
}

export { PricingError };
