import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase, getAuthUser } from "@/lib/supabase-server";
import { assertObjectFeature } from "@/lib/objectFeatures";
import { getEffectiveFieldConfig, getSalesConfig } from "@/lib/fieldConfig";
import { buildObjectSpec } from "@/lib/import/registrySchema";
import { validateRow, hasBlockingIssue } from "@/lib/import/validate";
import { collectCustomData, fetchAllRows, nameKey, readImportBody, summarise } from "@/lib/import/server";
import type { RowOutcome } from "@/lib/import/types";
import { NORMALISE } from "@/lib/abm/dw";
import { addTargets, MAX_ADD_PER_CALL, type AbmCtx, type AddExtras } from "@/lib/abm/server";
import type { AbmProgram, AbmTier } from "@/lib/abm/types";

// Data Workbench import of target accounts: the program ref and the account NAME resolve the
// relationship at create time (the business keys of bpmsquarecore section 3). Rows go through the same
// addTargets() the screen uses, so the owner comes from Coverage and every row is tenant-verified,
// logged and emitted exactly as an add from the program page. Progress is never imported.

export async function POST(request: NextRequest) {
  let session;
  try {
    session = await requireTenantUser();
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const { supabase, tenantId, userId, role } = session;

  const gate = await assertObjectFeature(tenantId, "abm_targets");
  if (gate) return gate;

  const rows = readImportBody(await request.json());
  if (!rows) return NextResponse.json({ error: "No rows provided" }, { status: 400 });

  const [fieldConfig, salesConfig, programs, accounts, existing, user] = await Promise.all([
    getEffectiveFieldConfig(supabase, tenantId, "abm_target"),
    getSalesConfig(supabase, tenantId),
    fetchAllRows<AbmProgram>(supabase, "abm_programs", "*", tenantId),
    fetchAllRows<{ id: string; name: string }>(supabase, "accounts", "id, name", tenantId),
    fetchAllRows<{ program_id: string; account_id: string }>(supabase, "abm_target_accounts", "program_id, account_id", tenantId),
    getAuthUser(),
  ]);
  const spec = buildObjectSpec("abm_targets", fieldConfig, salesConfig);
  const programByRef = new Map(programs.filter((p) => p.ref).map((p) => [String(p.ref).toUpperCase(), p]));
  const accountByName = new Map(accounts.map((a) => [nameKey(a.name), a.id]));
  const have = new Set(existing.map((e) => `${e.program_id}|${e.account_id}`));

  const ctx: AbmCtx = {
    supabase, admin: createAdminSupabase(), tenantId, userId, role, email: user?.email ?? null,
    can: { view: true, create: true, edit: true, delete: true },
  };

  const outcomes: RowOutcome[] = [];
  // program id -> account id -> { rowNum, extras }
  const plan = new Map<string, Map<string, { rowNum: number; extras: AddExtras }>>();

  for (const { rowNum, values } of rows) {
    const validated = validateRow(spec, values, rowNum);
    if (hasBlockingIssue(validated)) {
      outcomes.push({ rowNum, status: "failed", reason: validated.issues.filter((i) => i.severity === "error").map((i) => i.message).join("; ") });
      continue;
    }
    const v = validated.values;
    const program = programByRef.get(String(v.program_ref ?? "").trim().toUpperCase());
    if (!program) { outcomes.push({ rowNum, status: "failed", reason: `Program "${v.program_ref}" was not found — check the Program ID` }); continue; }
    const accountId = accountByName.get(nameKey(v.account_name ?? ""));
    if (!accountId) { outcomes.push({ rowNum, status: "failed", reason: `Account "${v.account_name}" was not found — import accounts first, or check the spelling` }); continue; }
    if (have.has(`${program.id}|${accountId}`) || plan.get(program.id)?.has(accountId)) {
      outcomes.push({ rowNum, status: "skipped", reason: "Already in this program" });
      continue;
    }
    const extras: AddExtras = {};
    let failed: string | null = null;
    for (const key of ["tier", "next_step", "next_step_due"] as const) {
      if (!v[key]) continue;
      const n = NORMALISE[key](v[key]);
      if (!n.ok) { failed = n.reason; break; }
      (extras as Record<string, unknown>)[key] = n.value;
    }
    if (failed) { outcomes.push({ rowNum, status: "failed", reason: failed }); continue; }
    const custom = collectCustomData(values);
    if (custom) extras.custom_data = custom;
    const forProgram = plan.get(program.id) ?? new Map();
    forProgram.set(accountId, { rowNum, extras });
    plan.set(program.id, forProgram);
  }

  for (const [programId, accountsMap] of plan) {
    const program = programs.find((p) => p.id === programId) as AbmProgram;
    const entries = [...accountsMap.entries()];
    for (let i = 0; i < entries.length; i += MAX_ADD_PER_CALL) {
      const chunk = entries.slice(i, i + MAX_ADD_PER_CALL);
      try {
        const result = await addTargets(ctx, program, chunk.map(([a]) => a), "import", program.default_tier as AbmTier, new Map(chunk.map(([a, x]) => [a, x.extras])));
        for (const [, x] of chunk) outcomes.push(result.added > 0 ? { rowNum: x.rowNum, status: "inserted" } : { rowNum: x.rowNum, status: "skipped", reason: "Not added" });
      } catch (e) {
        const reason = (e as { message?: string }).message ?? "Could not add";
        for (const [, x] of chunk) outcomes.push({ rowNum: x.rowNum, status: "failed", reason });
      }
    }
  }

  return NextResponse.json(summarise(outcomes));
}
