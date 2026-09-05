import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, getAuthUser } from "@/lib/supabase-server";
import { nextMasterRefSeq, formatMasterRef } from "@/lib/masterRef";
import { getEffectiveFieldConfig, getSalesConfig } from "@/lib/fieldConfig";
import { buildObjectSpec } from "@/lib/import/registrySchema";
import { validateRow, hasBlockingIssue } from "@/lib/import/validate";
import {
  collectCustomData, fetchAllRows, insertRows, nameKey, readImportBody, summarise, type PreparedRow,
} from "@/lib/import/server";
import type { RowOutcome } from "@/lib/import/types";
import { nextChildRef, depthOf, canNest } from "@/lib/wfm/projectTree";

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// POST /api/import/wfm_projects -- Data Workbench import. A sub-project
// names its parent by Project ID (parent_ref, e.g. PRJ-0003) and is numbered
// inside it exactly as the app does (PRJ-0003.1); a top-level row takes the
// next workspace PRJ number. Parents must already exist -- import them in
// an earlier file, or an earlier row does not help because refs are assigned
// before insert. Same rule as the screen: a parent already at Level 3 cannot
// take a child.
export async function POST(request: NextRequest) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const rows = readImportBody(await request.json());
  if (!rows) return NextResponse.json({ error: "No rows provided" }, { status: 400 });

  const [fieldConfig, salesConfig, existing, accounts] = await Promise.all([
    getEffectiveFieldConfig(supabase, tenantId, "project"),
    getSalesConfig(supabase, tenantId),
    fetchAllRows<{ id: string; ref: string | null; parent_id: string | null }>(supabase, "wfm_projects", "id, ref, parent_id", tenantId),
    fetchAllRows<{ id: string; name: string }>(supabase, "accounts", "id, name", tenantId),
  ]);
  const spec = buildObjectSpec("wfm_projects", fieldConfig, salesConfig);

  const byRef = new Map(existing.filter((p) => p.ref).map((p) => [p.ref!.toUpperCase(), p]));
  const nodes = new Map(existing.map((p) => [p.id, { id: p.id, parent_id: p.parent_id }]));
  const accountByName = new Map(accounts.map((a) => [nameKey(a.name), a.id]));
  // Refs already taken, including ones assigned earlier in this same file,
  // so two new children of the same parent get .4 and .5, not .4 twice.
  const takenRefs: (string | null)[] = existing.map((p) => p.ref);

  const prepared: PreparedRow[] = [];
  const outcomes: RowOutcome[] = [];
  let refSeq = await nextMasterRefSeq(supabase, "wfm_projects", tenantId);

  for (const { rowNum, values } of rows) {
    const validated = validateRow(spec, values, rowNum);
    if (hasBlockingIssue(validated)) {
      outcomes.push({
        rowNum, status: "failed",
        reason: validated.issues.filter((i) => i.severity === "error").map((i) => i.message).join("; "),
      });
      continue;
    }
    const v = validated.values;

    let parentId: string | null = null;
    let ref: string;
    const parentRef = (values.parent_ref ?? "").trim().toUpperCase();
    if (parentRef) {
      const parent = byRef.get(parentRef);
      if (!parent) { outcomes.push({ rowNum, status: "failed", reason: `Sits under "${values.parent_ref}" — no project with that ID` }); continue; }
      if (!canNest(depthOf(nodes, parent.id) ?? 0)) { outcomes.push({ rowNum, status: "failed", reason: `"${parent.ref}" is already at the deepest level` }); continue; }
      parentId = parent.id;
      ref = nextChildRef(parent.ref!, takenRefs);
    } else {
      ref = formatMasterRef("wfm_projects", refSeq++);
    }
    takenRefs.push(ref);

    let accountId: string | null = null;
    const accountName = (values.account_name ?? "").trim();
    if (accountName) {
      accountId = accountByName.get(nameKey(accountName)) ?? null;
      if (!accountId) { outcomes.push({ rowNum, status: "failed", reason: `Account "${accountName}" not found` }); continue; }
    }

    const custom = collectCustomData(values);
    prepared.push({
      rowNum,
      record: {
        tenant_id: tenantId,
        ref,
        name: v.name,
        code: v.code ?? null,
        parent_id: parentId,
        account_id: accountId,
        status: v.status || "active",
        start_date: v.start_date || null,
        end_date: v.end_date || null,
        budget_hours: num(v.budget_hours),
        bill_rate: num(v.bill_rate),
        ...(custom ? { custom_data: custom } : {}),
      },
    });
  }

  if (prepared.length === 0) return NextResponse.json(summarise(outcomes));
  const user = await getAuthUser();
  return NextResponse.json(await insertRows(supabase, "wfm_projects", prepared, outcomes, {
    objectType: "wfm_projects", labelField: "name", actorId: user?.id, actorEmail: user?.email,
  }));
}
