import { NextResponse } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { resolvePermissions, canEditWorkcenter } from "@/lib/permissions";
import { parseFormula, type CostSourceDef } from "@/lib/pricing-core";
import { COMPONENT_ENUMS, COST_INPUT_KINDS, COST_QUALITIES } from "@/lib/pricing/enums";
import { validateSources } from "@/lib/pricing/validate";

// One mutation surface for all PricingEngine config entities (admin,
// session-auth, service-role writes — the pricing tables are select-only
// under RLS by design). Versioned entities (component / procedure / rule /
// cost_model) may only be edited while their config version is DRAFT — a
// PUBLISHED version is immutable (spec §7). Dimensions and cost inputs are
// version-independent: dimensions are the tenant's matching vocabulary;
// cost inputs resolve by effective date (§3).
//
// POST { entity, op: "upsert" | "delete", version?, data: {...} }

type MutationBody = {
  entity?: "dimension" | "component" | "procedure" | "rule" | "cost_model" | "cost_input";
  op?: "upsert" | "delete";
  version?: number;
  area?: string;
  data?: Record<string, unknown>;
};

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 422 });
}

export async function POST(req: Request) {
  let tenantId: string, userId: string;
  try {
    const auth = await requireTenantUser();
    const perms = await resolvePermissions(auth.supabase, auth.tenantId, auth.userId, auth.role);
    if (!canEditWorkcenter(perms, "pricing")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    tenantId = auth.tenantId;
    userId = auth.userId;
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    return NextResponse.json({ error: err.message ?? "Unauthorized" }, { status: err.status ?? 401 });
  }

  const body = (await req.json().catch(() => null)) as MutationBody | null;
  if (!body) return NextResponse.json({ error: "Malformed JSON" }, { status: 400 });
  const { entity, op, data } = body;
  if (!entity || !op || typeof data !== "object" || data === null) {
    return bad("Body needs { entity, op: upsert|delete, data }.");
  }

  const admin = createAdminSupabase();
  const area = typeof body.area === "string" && body.area.trim() ? body.area.trim() : "default";

  // Versioned entities require a DRAFT version.
  const versioned = ["component", "procedure", "rule", "cost_model"].includes(entity);
  let version: number | null = null;
  if (versioned) {
    if (typeof body.version !== "number") return bad(`entity "${entity}" requires a config \`version\`.`);
    version = body.version;
    const { data: v } = await admin
      .from("pricing_config_versions")
      .select("status")
      .eq("tenant_id", tenantId).eq("pricing_area", area).eq("version", version)
      .maybeSingle();
    if (!v) return NextResponse.json({ error: `Config version ${version} not found.` }, { status: 404 });
    if (v.status !== "DRAFT") {
      return NextResponse.json({ error: `Version ${version} is ${v.status} — only DRAFT versions are editable. Create a new draft (optionally cloning this one).` }, { status: 409 });
    }
  }

  switch (entity) {
    // ── dimensions (version-independent) ──────────────────────────────────
    case "dimension": {
      const attribute = typeof data.attribute === "string" ? data.attribute.trim() : "";
      if (!attribute) return bad("dimension needs `attribute`.");
      if (op === "delete") {
        const { error } = await admin.from("pricing_dimensions").delete().eq("tenant_id", tenantId).eq("attribute", attribute);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ ok: true });
      }
      const weight = Number(data.weight);
      if (!Number.isInteger(weight) || weight <= 0) return bad("dimension needs an integer `weight` > 0.");
      const { error } = await admin.from("pricing_dimensions").upsert(
        { tenant_id: tenantId, attribute, weight, label: (data.label as string) ?? null },
        { onConflict: "tenant_id,attribute" }
      );
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    // ── components ────────────────────────────────────────────────────────
    case "component": {
      const code = typeof data.code === "string" ? data.code.trim().toUpperCase() : "";
      if (!code) return bad("component needs `code`.");
      if (op === "delete") {
        const { error } = await admin.from("pricing_components").delete()
          .eq("tenant_id", tenantId).eq("config_version", version!).eq("code", code);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ ok: true });
      }
      for (const [field, allowed] of Object.entries(COMPONENT_ENUMS)) {
        const value = data[field];
        if (value !== undefined && !(allowed as readonly string[]).includes(value as string)) {
          return bad(`component.${field} must be one of: ${(allowed as readonly string[]).join(", ")}.`);
        }
      }
      const { error } = await admin.from("pricing_components").upsert({
        tenant_id: tenantId, config_version: version!, code,
        name: (data.name as string) ?? code,
        class: (data.class as string) ?? "PRICE",
        calc_type: (data.calc_type as string) ?? "FIXED_AMOUNT",
        calc_basis: (data.calc_basis as string) ?? "NET_SO_FAR",
        sign: (data.sign as string) ?? "BOTH",
        rounding_rule: data.rounding_rule ?? null,
        manual_override: (data.manual_override as string) ?? "FORBIDDEN",
        is_statistical: Boolean(data.is_statistical),
        resolution_strategy: (data.resolution_strategy as string) ?? "MOST_SPECIFIC",
      }, { onConflict: "tenant_id,config_version,code" });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    // ── procedures ────────────────────────────────────────────────────────
    case "procedure": {
      const code = typeof data.code === "string" ? data.code.trim().toUpperCase() : "";
      if (!code) return bad("procedure needs `code`.");
      if (op === "delete") {
        const { error } = await admin.from("pricing_procedures").delete()
          .eq("tenant_id", tenantId).eq("config_version", version!).eq("code", code);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ ok: true });
      }
      const steps = data.steps;
      if (!Array.isArray(steps)) return bad("procedure needs `steps` (array).");
      for (const s of steps as Record<string, unknown>[]) {
        if (typeof s.step !== "number") return bad("every procedure step needs a numeric `step`.");
        if (!s.component && !s.subtotal) return bad(`step ${s.step}: needs component or subtotal.`);
      }
      const entryMode = (data.entry_mode as string) ?? "LIST_DOWN";
      if (!["LIST_DOWN", "COST_UP"].includes(entryMode)) return bad("entry_mode must be LIST_DOWN or COST_UP.");
      const { error } = await admin.from("pricing_procedures").upsert({
        tenant_id: tenantId, config_version: version!, code,
        name: (data.name as string) ?? code, entry_mode: entryMode, steps,
      }, { onConflict: "tenant_id,config_version,code" });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    // ── rules ─────────────────────────────────────────────────────────────
    case "rule": {
      if (op === "delete") {
        const id = typeof data.id === "string" ? data.id : "";
        if (!id) return bad("rule delete needs `id`.");
        const { error } = await admin.from("pricing_rules").delete()
          .eq("tenant_id", tenantId).eq("config_version", version!).eq("id", id);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ ok: true });
      }
      const componentCode = typeof data.component_code === "string" ? data.component_code.trim().toUpperCase() : "";
      if (!componentCode) return bad("rule needs `component_code`.");
      const matchAttributes = (data.match_attributes ?? {}) as Record<string, unknown>;
      if (typeof matchAttributes !== "object" || Array.isArray(matchAttributes)) return bad("rule.match_attributes must be an object.");

      // Authoring-time guards: attributes must be registered dimensions, and
      // a formula must parse — the same checks publish repeats, but failing
      // here means bad config never even lands in the draft.
      const { data: dims } = await admin.from("pricing_dimensions").select("attribute").eq("tenant_id", tenantId);
      const registered = new Set((dims ?? []).map((d) => d.attribute as string));
      for (const attr of Object.keys(matchAttributes)) {
        if (!registered.has(attr)) return bad(`rule attribute "${attr}" is not in the DimensionRegistry — register it first.`);
      }
      if (typeof data.formula === "string" && data.formula.trim()) {
        try { parseFormula(data.formula); } catch (e) {
          return bad(`rule formula does not parse: ${(e as Error).message}`);
        }
      }

      const row = {
        tenant_id: tenantId, config_version: version!, component_code: componentCode,
        match_attributes: matchAttributes,
        value: data.value === null || data.value === undefined ? null : Number(data.value),
        scale: data.scale ?? null,
        formula: (data.formula as string) ?? null,
        currency: (data.currency as string) ?? null,
        uom: (data.uom as string) ?? null,
        valid_from: (data.valid_from as string) ?? null,
        valid_to: (data.valid_to as string) ?? null,
        origin: "MANUAL", created_by: userId,
      };
      if (typeof data.id === "string" && data.id) {
        const { error } = await admin.from("pricing_rules").update(row)
          .eq("tenant_id", tenantId).eq("config_version", version!).eq("id", data.id);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ ok: true, id: data.id });
      }
      const { data: created, error } = await admin.from("pricing_rules").insert(row).select("id").single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true, id: created.id }, { status: 201 });
    }

    // ── cost models ───────────────────────────────────────────────────────
    case "cost_model": {
      const code = typeof data.code === "string" ? data.code.trim().toUpperCase() : "";
      if (!code) return bad("cost_model needs `code`.");
      if (op === "delete") {
        const { error } = await admin.from("pricing_cost_models").delete()
          .eq("tenant_id", tenantId).eq("config_version", version!).eq("code", code);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ ok: true });
      }
      // The source ladder (0113): validated here so a broken rung can never
      // land in a draft -- publish repeats the checks.
      let sources: CostSourceDef[] | undefined;
      if (data.sources !== undefined) {
        const check = validateSources(data.sources);
        if ("error" in check) return bad(check.error);
        sources = check.sources;
      }
      const { error } = await admin.from("pricing_cost_models").upsert({
        tenant_id: tenantId, config_version: version!, code, name: (data.name as string) ?? code,
        ...(sources !== undefined ? { sources } : {}),
      }, { onConflict: "tenant_id,config_version,code" });
      if (error) {
        // 42703 = sources column missing: migration 0113 pending. Keep the
        // model editable without the ladder rather than failing authoring.
        if (sources !== undefined && (error.code === "42703" || /sources/.test(error.message))) {
          const { error: retry } = await admin.from("pricing_cost_models").upsert({
            tenant_id: tenantId, config_version: version!, code, name: (data.name as string) ?? code,
          }, { onConflict: "tenant_id,config_version,code" });
          if (retry) return NextResponse.json({ error: retry.message }, { status: 500 });
          return NextResponse.json({ ok: true, warning: "Source ladder not saved: migration 0113 is pending." });
        }
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      return NextResponse.json({ ok: true });
    }

    // ── cost inputs (version-independent, effective-dated) ────────────────
    case "cost_input": {
      if (op === "delete") {
        const id = typeof data.id === "string" ? data.id : "";
        if (!id) return bad("cost_input delete needs `id`.");
        const { error } = await admin.from("pricing_cost_inputs").delete()
          .eq("tenant_id", tenantId).eq("id", id);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ ok: true });
      }
      const modelCode = typeof data.cost_model_code === "string" ? data.cost_model_code.trim().toUpperCase() : "";
      const path = typeof data.path === "string" ? data.path.trim() : "";
      const kind = data.kind as string;
      const value = Number(data.value);
      if (!modelCode || !path) return bad("cost_input needs `cost_model_code` and `path`.");
      if (!COST_INPUT_KINDS.includes(kind)) return bad(`cost_input.kind must be one of: ${COST_INPUT_KINDS.join(", ")}.`);
      if (!Number.isFinite(value)) return bad("cost_input needs a numeric `value`.");
      if (/__|constructor|prototype/.test(path)) return bad("cost_input path contains an illegal segment.");

      // Provenance (0113). A product-scoped figure must name a product of
      // THIS tenant -- a client-supplied id is verified before it is stored.
      const sourceCode = typeof data.source_code === "string" && data.source_code.trim() ? data.source_code.trim().toUpperCase() : null;
      const quality = data.quality === undefined || data.quality === null ? null : (data.quality as string);
      if (quality !== null && !COST_QUALITIES.includes(quality)) return bad(`cost_input.quality must be one of: ${COST_QUALITIES.join(", ")}.`);
      const asOf = typeof data.as_of === "string" && data.as_of ? data.as_of : null;
      let productId: string | null = null;
      if (typeof data.product_id === "string" && data.product_id) {
        const { data: p } = await admin.from("products").select("id").eq("id", data.product_id).eq("tenant_id", tenantId).maybeSingle();
        if (!p) return NextResponse.json({ error: "Product not found" }, { status: 404 });
        productId = p.id as string;
      }
      const row = {
        tenant_id: tenantId, cost_model_code: modelCode, path, kind, value,
        uom: (data.uom as string) ?? null, currency: (data.currency as string) ?? null,
        valid_from: (data.valid_from as string) ?? null, valid_to: (data.valid_to as string) ?? null,
        source: "MANUAL", created_by: userId,
        source_code: sourceCode, quality, as_of: asOf, product_id: productId,
      };
      if (typeof data.id === "string" && data.id) {
        const { error } = await admin.from("pricing_cost_inputs").update(row).eq("tenant_id", tenantId).eq("id", data.id);
        if (error) {
          // 23505 on the natural key: the edit collides with another rate
          // for the same path and start date -- say which, don't 500.
          if (error.code === "23505") return bad(`A rate for ${modelCode} ${path} starting ${row.valid_from ?? "(open)"} already exists — edit that one instead.`);
          return NextResponse.json({ error: error.message }, { status: 500 });
        }
        return NextResponse.json({ ok: true, id: data.id });
      }
      // (tenant, model, path, source, product, valid_from) is the natural key
      // (0111 + 0113): re-adding the same figure updates it rather than
      // creating a twin the engine would refuse to resolve.
      const { data: created, error } = await admin
        .from("pricing_cost_inputs")
        .upsert(row, { onConflict: "tenant_id,cost_model_code,path,source_key,product_key,valid_from_key" })
        .select("id").single();
      if (error) {
        // 42703 = a key column does not exist: 0111/0113 pending. Fall back
        // to a plain insert of the columns that do exist so authoring keeps
        // working; the duplicate guard simply isn't there yet.
        if (error.code === "42703" || /_key|source_code|quality|as_of|product_id/.test(error.message)) {
          const { source_code: _s, quality: _q, as_of: _a, product_id: _p, ...legacy } = row;
          const { data: inserted, error: insErr } = await admin.from("pricing_cost_inputs").insert(legacy).select("id").single();
          if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
          return NextResponse.json({ ok: true, id: inserted.id, warning: "Provenance not saved: migration 0113 is pending." }, { status: 201 });
        }
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      return NextResponse.json({ ok: true, id: created.id }, { status: 201 });
    }

    default:
      return bad(`Unknown entity "${entity}".`);
  }
}
