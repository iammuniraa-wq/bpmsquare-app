import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, getAuthUser } from "@/lib/supabase-server";
import { assertObjectFeature } from "@/lib/objectFeatures";
import { resolvePermissions, canCreateWorkcenter } from "@/lib/permissions";
import { nextMasterRefSeq, formatMasterRef } from "@/lib/masterRef";
import { getEffectiveFieldConfig, getSalesConfig } from "@/lib/fieldConfig";
import { buildObjectSpec } from "@/lib/import/registrySchema";
import { validateRow, hasBlockingIssue } from "@/lib/import/validate";
import { collectCustomData, fetchAllRows, insertRows, nameKey, readImportBody, summarise, type PreparedRow } from "@/lib/import/server";
import type { RowOutcome } from "@/lib/import/types";
import { parseMargin } from "@/lib/estimator/requests";
import { loadTenantMeta } from "@/lib/estimator/server";

// Data Workbench import of estimates (§3b-4). HEADER FIELDS ONLY: a row creates a DRAFT
// estimate from a template named in the file (the create-time business key, §3); its lines,
// quantities and costs come from the estimator, so the new estimate has none until someone
// opens it and presses Calculate. Account / contact are optional, resolved by name (a
// contact only within the resolved account). Status is always draft; ref is assigned here.
export async function POST(request: NextRequest) {
  let supabase, tenantId, userId, role;
  try {
    ({ supabase, tenantId, userId, role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const gate = await assertObjectFeature(tenantId, "estimates");
  if (gate) return gate;
  const perms = await resolvePermissions(supabase, tenantId, userId, role);
  if (!canCreateWorkcenter(perms, "estimates")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const rows = readImportBody(await request.json());
  if (!rows) return NextResponse.json({ error: "No rows provided" }, { status: 400 });

  const [fieldConfig, salesConfig, accounts, contacts, templates, meta] = await Promise.all([
    getEffectiveFieldConfig(supabase, tenantId, "estimate"),
    getSalesConfig(supabase, tenantId),
    fetchAllRows<{ id: string; name: string }>(supabase, "accounts", "id, name", tenantId),
    fetchAllRows<{ id: string; name: string; account_id: string }>(supabase, "contacts", "id, name, account_id", tenantId),
    fetchAllRows<{ id: string; name: string; version: number; is_active: boolean }>(supabase, "estimate_templates", "id, name, version, is_active", tenantId),
    loadTenantMeta(tenantId),
  ]);
  if (templates.length === 0) {
    return NextResponse.json({ error: "This workspace has no estimate templates yet (or the estimator database update is pending)." }, { status: 409 });
  }
  const spec = buildObjectSpec("estimates", fieldConfig, salesConfig);
  const accountByName = new Map(accounts.map((a) => [nameKey(a.name), a.id]));
  const contactByKey = new Map(contacts.map((c) => [`${c.account_id}|${nameKey(c.name)}`, c.id]));
  const templateByName = new Map(templates.map((t) => [nameKey(t.name), t]));

  const prepared: PreparedRow[] = [];
  const outcomes: RowOutcome[] = [];
  let refSeq = await nextMasterRefSeq(supabase, "estimates", tenantId);

  for (const { rowNum, values } of rows) {
    const validated = validateRow(spec, values, rowNum);
    if (hasBlockingIssue(validated)) {
      outcomes.push({ rowNum, status: "failed", reason: validated.issues.filter((i) => i.severity === "error").map((i) => i.message).join("; ") });
      continue;
    }
    const v = validated.values;
    const tpl = templateByName.get(nameKey(v.template_name ?? ""));
    if (!tpl) { outcomes.push({ rowNum, status: "failed", reason: `Template "${v.template_name}" was not found. Check the spelling against Settings, Estimate templates` }); continue; }
    if (!tpl.is_active) { outcomes.push({ rowNum, status: "failed", reason: `Template "${tpl.name}" is inactive` }); continue; }
    let accountId: string | null = null;
    if (v.account_name) {
      accountId = accountByName.get(nameKey(v.account_name)) ?? null;
      if (!accountId) { outcomes.push({ rowNum, status: "failed", reason: `Account "${v.account_name}" was not found. Import accounts first, or check the spelling` }); continue; }
    }
    let contactId: string | null = null;
    if (v.contact_name) {
      contactId = accountId ? (contactByKey.get(`${accountId}|${nameKey(v.contact_name)}`) ?? null) : null;
      if (!contactId) { outcomes.push({ rowNum, status: "failed", reason: `Contact "${v.contact_name}" was not found at that account` }); continue; }
    }
    let margin = 0;
    if (v.margin_pct !== undefined && String(v.margin_pct).trim() !== "") {
      const m = parseMargin(v.margin_pct);
      if (m === null) { outcomes.push({ rowNum, status: "failed", reason: "Margin must be between 0 and 1000 percent" }); continue; }
      margin = m;
    }
    const custom = collectCustomData(values);
    prepared.push({
      rowNum,
      record: {
        tenant_id: tenantId,
        ref: formatMasterRef("estimates", refSeq++),
        name: v.name,
        account_id: accountId,
        contact_id: contactId,
        template_id: tpl.id,
        template_version: tpl.version,
        status: "draft",
        params: {},
        currency: v.currency || meta.currency,
        margin_pct: margin,
        notes: v.notes || null,
        created_by: userId,
        ...(custom ? { custom_data: custom } : {}),
      },
    });
  }

  if (prepared.length === 0) return NextResponse.json(summarise(outcomes));
  const user = await getAuthUser();
  return NextResponse.json(await insertRows(supabase, "estimates", prepared, outcomes, {
    objectType: "estimates", labelField: "name", actorId: user?.id, actorEmail: user?.email,
  }));
}
