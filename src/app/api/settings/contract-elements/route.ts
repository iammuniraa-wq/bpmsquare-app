import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase, getAuthUser } from "@/lib/supabase-server";
import { buildingsOn } from "@/lib/elements/server";
import { logChange } from "@/lib/changeLog";
import { validatePattern, previewCodes } from "@/lib/elements/pattern";
import { ELEMENT_LIMITS, resolveElementsSettings, type ContractElementsConfig } from "@/lib/elements/types";

// GET / PUT /api/settings/contract-elements -- the workspace settings of buildings and element codes, held in tenants.config.contract_elements:
//   pattern             how element codes are built: {building}, {type}, {project}, {seq:N} joined by - . _ /   (default {building}-{type}-{seq:4})
//   code_max            the longest element code (6 to 40, default 20, the ERP's item-number length)
//   qty_tolerance_pct   a model quantity within this percent of the client's is fine, over it amber, over twice it red (default 5)
//   level_names         the words for the WBS levels: { building, activity, cost_element }, display only
// PUT takes any of them and keeps the rest. A pattern that does not parse, has no {seq}, or could make a code longer than `code_max` is refused (422)
// with the reason. A change only affects projects that have not issued a code yet (a project freezes the pattern with its first code).
// Admin-only in both directions; a workspace without Contract projects and the Buildings add-on gets a 404.

async function guard() {
  const ctx = await requireTenantUser();
  if (!(await buildingsOn(ctx.supabase, ctx.tenantId))) throw Object.assign(new Error("Not found"), { status: 404 });
  if (ctx.role !== "admin") throw Object.assign(new Error("Forbidden"), { status: 403 });
  return ctx;
}
const fail = (e: unknown) => {
  const err = e as { status?: number; message: string };
  return NextResponse.json({ error: err.message }, { status: err.status ?? 401 });
};

const shown = (raw: unknown) => {
  const s = resolveElementsSettings(raw);
  const check = validatePattern(s.pattern, s.code_max);
  return { ...s, pattern_ok: check.ok, max_length: check.ok ? check.max_length : null, preview: check.ok ? previewCodes(check.parts) : [] };
};

export async function GET() {
  let tenantId;
  try { ({ tenantId } = await guard()); } catch (e) { return fail(e); }
  const { data } = await createAdminSupabase().from("tenants").select("config").eq("id", tenantId).single();
  const config = (data?.config ?? null) as { contract_elements?: ContractElementsConfig } | null;
  return NextResponse.json(shown(config?.contract_elements));
}

export async function PUT(request: NextRequest) {
  let supabase, tenantId;
  try { ({ supabase, tenantId } = await guard()); } catch (e) { return fail(e); }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  const admin = createAdminSupabase();
  const { data: current, error: readErr } = await admin.from("tenants").select("config").eq("id", tenantId).single();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  const config = (current?.config ?? {}) as { contract_elements?: ContractElementsConfig } & Record<string, unknown>;
  const before = resolveElementsSettings(config.contract_elements);
  const next: ContractElementsConfig = { ...(config.contract_elements ?? {}) };

  if ("code_max" in body) {
    const n = Number(body.code_max);
    if (!Number.isInteger(n) || n < 6 || n > ELEMENT_LIMITS.codeMaxHard) return NextResponse.json({ error: `The longest code is a whole number from 6 to ${ELEMENT_LIMITS.codeMaxHard}` }, { status: 422 });
    next.code_max = n;
  }
  if ("pattern" in body) {
    if (typeof body.pattern !== "string") return NextResponse.json({ error: "The pattern must be text" }, { status: 422 });
    next.pattern = body.pattern.trim();
  }
  const merged = resolveElementsSettings(next);
  if ("pattern" in body || "code_max" in body) {
    const check = validatePattern(merged.pattern, merged.code_max);
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: 422 });
  }
  if ("qty_tolerance_pct" in body) {
    const n = Number(body.qty_tolerance_pct);
    if (!Number.isFinite(n) || n < 0 || n > 100) return NextResponse.json({ error: "The tolerance is a number from 0 to 100" }, { status: 422 });
    next.qty_tolerance_pct = Math.round(n * 10) / 10;
  }
  if ("level_names" in body) {
    const ln = body.level_names;
    if (!ln || typeof ln !== "object") return NextResponse.json({ error: "level_names must be an object" }, { status: 422 });
    const names: Record<string, string> = {};
    for (const key of ["building", "activity", "cost_element"] as const) {
      const v = (ln as Record<string, unknown>)[key];
      if (typeof v === "string" && v.trim()) names[key] = v.trim().slice(0, 30);
    }
    next.level_names = names;
  }
  if (Object.keys(body).length === 0) return NextResponse.json({ error: "Nothing to save" }, { status: 400 });

  const { error } = await admin.from("tenants").update({ config: { ...config, contract_elements: next } }).eq("id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const after = resolveElementsSettings(next);
  const user = await getAuthUser();
  const changes: { field: string; from: unknown; to: unknown }[] = [];
  if (before.pattern !== after.pattern) changes.push({ field: "Element code pattern", from: before.pattern, to: after.pattern });
  if (before.code_max !== after.code_max) changes.push({ field: "Longest element code", from: before.code_max, to: after.code_max });
  if (before.qty_tolerance_pct !== after.qty_tolerance_pct) changes.push({ field: "Quantity tolerance (%)", from: before.qty_tolerance_pct, to: after.qty_tolerance_pct });
  if (JSON.stringify(before.level_names) !== JSON.stringify(after.level_names)) changes.push({ field: "WBS level names", from: Object.values(before.level_names).join(" / "), to: Object.values(after.level_names).join(" / ") });
  if (changes.length > 0) await logChange(supabase, { tenantId, objectType: "tenants", objectId: tenantId, objectLabel: "Contract project settings", action: "update", actorId: user?.id, actorEmail: user?.email, changes });
  return NextResponse.json(shown(next));
}
