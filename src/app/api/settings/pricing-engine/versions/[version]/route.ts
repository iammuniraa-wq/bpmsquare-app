import { NextResponse } from "next/server";
import { requireTenantUser, createAdminSupabase, getAuthUser } from "@/lib/supabase-server";
import { resolvePermissions, canViewWorkcenter, canEditWorkcenter, canDeleteWorkcenter } from "@/lib/permissions";
import { logChange } from "@/lib/changeLog";
import { parseFormula } from "@/lib/pricing-core";
import type { ProcedureStep } from "@/lib/pricing-core";
import { validateSources, validateGuardrails } from "@/lib/pricing/validate";

// One config version: GET the full snapshot; POST {action:"publish"} runs the
// pre-publish validation report and, only when clean, flips DRAFT->PUBLISHED
// (the previous PUBLISHED becomes SUPERSEDED). Validation failures return the
// report with a 422 -- a broken config can never go live silently (spec §7).
// DELETE discards a DRAFT outright (the "Pricing setup" wizard's invisible-
// versioning "Discard changes" action) -- only ever a DRAFT; PUBLISHED/
// SUPERSEDED versions are immutable history and refuse deletion.

async function requireView() {
  const auth = await requireTenantUser();
  const perms = await resolvePermissions(auth.supabase, auth.tenantId, auth.userId, auth.role);
  if (!canViewWorkcenter(perms, "pricing")) throw { status: 403, message: "Forbidden" };
  return auth;
}

async function requireEdit() {
  const auth = await requireTenantUser();
  const perms = await resolvePermissions(auth.supabase, auth.tenantId, auth.userId, auth.role);
  if (!canEditWorkcenter(perms, "pricing")) throw { status: 403, message: "Forbidden" };
  return auth;
}

async function requireDelete() {
  const auth = await requireTenantUser();
  const perms = await resolvePermissions(auth.supabase, auth.tenantId, auth.userId, auth.role);
  if (!canDeleteWorkcenter(perms, "pricing")) throw { status: 403, message: "Forbidden" };
  return auth;
}

type Ctx = { params: Promise<{ version: string }> };

async function loadSnapshot(tenantId: string, area: string, version: number) {
  const admin = createAdminSupabase();
  const [versionRow, components, procedures, rules, models, dimensions, inputs] = await Promise.all([
    admin.from("pricing_config_versions").select("*").eq("tenant_id", tenantId).eq("pricing_area", area).eq("version", version).maybeSingle(),
    admin.from("pricing_components").select("*").eq("tenant_id", tenantId).eq("config_version", version).order("code"),
    admin.from("pricing_procedures").select("*").eq("tenant_id", tenantId).eq("config_version", version).order("code"),
    admin.from("pricing_rules").select("*").eq("tenant_id", tenantId).eq("config_version", version).order("created_at"),
    admin.from("pricing_cost_models").select("*").eq("tenant_id", tenantId).eq("config_version", version).order("code"),
    admin.from("pricing_dimensions").select("attribute, weight, label").eq("tenant_id", tenantId).order("attribute"),
    admin.from("pricing_cost_inputs").select("*").eq("tenant_id", tenantId).order("cost_model_code, path, valid_from"),
  ]);
  return {
    version: versionRow.data,
    components: components.data ?? [],
    procedures: procedures.data ?? [],
    rules: rules.data ?? [],
    cost_models: models.data ?? [],
    dimensions: dimensions.data ?? [],
    cost_inputs: inputs.data ?? [],
  };
}

function validateForPublish(snapshot: Awaited<ReturnType<typeof loadSnapshot>>): string[] {
  const errors: string[] = [];
  const componentCodes = new Set(snapshot.components.map((c) => c.code as string));
  const modelCodes = new Set(snapshot.cost_models.map((m) => m.code as string));
  const dimensionAttrs = new Set(snapshot.dimensions.map((d) => d.attribute as string));

  if (snapshot.procedures.length === 0) errors.push("No procedures defined — at least one is required.");

  for (const model of snapshot.cost_models) {
    if (Array.isArray(model.sources) && model.sources.length > 0) {
      const check = validateSources(model.sources);
      if ("error" in check) errors.push(`Cost model ${model.code}: ${check.error}`);
    }
  }

  for (const proc of snapshot.procedures) {
    const steps = (proc.steps ?? []) as ProcedureStep[];
    if (steps.length === 0) errors.push(`Procedure ${proc.code}: has no steps.`);
    errors.push(...validateGuardrails(proc.code as string, steps, componentCodes));
    for (const step of steps) {
      if (!step.component && !step.subtotal) errors.push(`Procedure ${proc.code} step ${step.step}: neither component nor subtotal.`);
      if (step.component && !componentCodes.has(step.component)) {
        errors.push(`Procedure ${proc.code} step ${step.step}: unknown component "${step.component}".`);
      }
      if (step.cost_model && !modelCodes.has(step.cost_model)) {
        errors.push(`Procedure ${proc.code} step ${step.step}: unknown cost model "${step.cost_model}".`);
      }
      const formula = step.formula ?? (step.requirement?.startsWith("dsl:") ? step.requirement.slice(4) : step.requirement);
      if (formula) {
        try { parseFormula(formula); } catch (e) {
          errors.push(`Procedure ${proc.code} step ${step.step}: formula does not parse — ${(e as Error).message}`);
        }
      }
    }
  }

  for (const rule of snapshot.rules) {
    if (!componentCodes.has(rule.component_code as string)) {
      errors.push(`Rule ${rule.id}: unknown component "${rule.component_code}".`);
    }
    for (const attr of Object.keys((rule.match_attributes ?? {}) as Record<string, unknown>)) {
      if (!dimensionAttrs.has(attr)) errors.push(`Rule ${rule.id}: attribute "${attr}" is not in the DimensionRegistry.`);
    }
    if (rule.formula) {
      try { parseFormula(rule.formula as string); } catch (e) {
        errors.push(`Rule ${rule.id}: formula does not parse — ${(e as Error).message}`);
      }
    }
  }

  return errors;
}

export async function GET(req: Request, { params }: Ctx) {
  let tenantId: string;
  try {
    ({ tenantId } = await requireView());
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    return NextResponse.json({ error: err.message ?? "Unauthorized" }, { status: err.status ?? 401 });
  }
  const version = parseInt((await params).version, 10);
  if (!Number.isInteger(version)) return NextResponse.json({ error: "Invalid version" }, { status: 422 });
  const area = new URL(req.url).searchParams.get("area") ?? "default";

  const snapshot = await loadSnapshot(tenantId, area, version);
  if (!snapshot.version) return NextResponse.json({ error: "Version not found" }, { status: 404 });
  return NextResponse.json(snapshot);
}

export async function POST(req: Request, { params }: Ctx) {
  let tenantId: string;
  try {
    ({ tenantId } = await requireEdit());
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    return NextResponse.json({ error: err.message ?? "Unauthorized" }, { status: err.status ?? 401 });
  }
  const version = parseInt((await params).version, 10);
  if (!Number.isInteger(version)) return NextResponse.json({ error: "Invalid version" }, { status: 422 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const area = typeof body.area === "string" && body.area.trim() ? body.area.trim() : "default";
  if (body.action !== "publish") {
    return NextResponse.json({ error: "Unknown action — supported: publish" }, { status: 422 });
  }

  const admin = createAdminSupabase();
  const snapshot = await loadSnapshot(tenantId, area, version);
  if (!snapshot.version) return NextResponse.json({ error: "Version not found" }, { status: 404 });
  if (snapshot.version.status !== "DRAFT") {
    return NextResponse.json({ error: `Only a DRAFT can be published (this version is ${snapshot.version.status}).` }, { status: 409 });
  }

  const report = validateForPublish(snapshot);
  if (report.length > 0) {
    return NextResponse.json({ error: "Validation failed — fix these before publishing", report }, { status: 422 });
  }

  // Supersede the current PUBLISHED (if any) and promote the draft in ONE
  // transaction (migration 0111, pricing_publish_version) so a failure can
  // never leave the area with no live version. The partial unique index
  // (one PUBLISHED per area) still guards the invariant underneath.
  const { error: publishErr } = await admin.rpc("pricing_publish_version", {
    p_tenant_id: tenantId, p_area: area, p_version: version,
  });
  if (publishErr) {
    // 42883 = function does not exist: migration 0111 is pending. Say so
    // rather than silently falling back to the non-atomic two-step.
    const pending = publishErr.code === "42883" || /pricing_publish_version/.test(publishErr.message);
    return NextResponse.json({
      error: pending
        ? "Publishing needs migration 0111 (pricing_publish_version) applied to this database."
        : `Publish failed: ${publishErr.message}`,
    }, { status: pending ? 503 : 500 });
  }

  const user = await getAuthUser();
  await logChange(admin, {
    tenantId, objectType: "pricing_config", objectId: String(version),
    objectLabel: `${area} v${version}`, action: "update",
    actorEmail: user?.email ?? null, changes: [{ field: "status", from: "DRAFT", to: "PUBLISHED" }],
  });

  return NextResponse.json({ area, version, status: "PUBLISHED" });
}

// DELETE -- discard a DRAFT outright: the version row and every versioned
// entity tied to it (components/procedures/rules/cost models). Only ever a
// DRAFT; PUBLISHED/SUPERSEDED are immutable history (spec §7) and refuse.
// This is the "Pricing setup" wizard's "Discard changes" button -- the
// invisible-versioning UX never shows the version number itself.
export async function DELETE(req: Request, { params }: Ctx) {
  let tenantId: string, userId: string;
  try {
    ({ tenantId, userId } = await requireDelete());
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    return NextResponse.json({ error: err.message ?? "Unauthorized" }, { status: err.status ?? 401 });
  }
  const version = parseInt((await params).version, 10);
  if (!Number.isInteger(version)) return NextResponse.json({ error: "Invalid version" }, { status: 422 });
  const area = new URL(req.url).searchParams.get("area") ?? "default";

  const admin = createAdminSupabase();
  const { data: row } = await admin
    .from("pricing_config_versions")
    .select("status")
    .eq("tenant_id", tenantId).eq("pricing_area", area).eq("version", version)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: "Version not found" }, { status: 404 });
  if (row.status !== "DRAFT") {
    return NextResponse.json({ error: `Only a DRAFT can be discarded (this version is ${row.status}).` }, { status: 409 });
  }

  for (const table of ["pricing_components", "pricing_procedures", "pricing_rules", "pricing_cost_models"] as const) {
    const { error } = await admin.from(table).delete().eq("tenant_id", tenantId).eq("config_version", version);
    if (error) return NextResponse.json({ error: `Discard failed clearing ${table}: ${error.message}` }, { status: 500 });
  }
  const { error: delErr } = await admin
    .from("pricing_config_versions")
    .delete()
    .eq("tenant_id", tenantId).eq("pricing_area", area).eq("version", version);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  const user = await getAuthUser();
  await logChange(admin, {
    tenantId, objectType: "pricing_config", objectId: String(version),
    objectLabel: `${area} v${version}`, action: "delete",
    actorId: userId, actorEmail: user?.email ?? null,
  });

  return NextResponse.json({ ok: true });
}
