import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, getAuthUser } from "@/lib/supabase-server";
import { assertObjectFeature } from "@/lib/objectFeatures";
import { getEffectiveFieldConfig, getSalesConfig } from "@/lib/fieldConfig";
import { buildObjectSpec } from "@/lib/import/registrySchema";
import { validateRow, hasBlockingIssue } from "@/lib/import/validate";
import { collectCustomData, fetchAllRows, insertRows, nameKey, readImportBody, summarise, type PreparedRow } from "@/lib/import/server";
import type { RowOutcome } from "@/lib/import/types";
import { NORMALISE } from "@/lib/abm/dw";

// Data Workbench import of buying group members. The program ref, the account name and the person's
// name resolve the relationship at create time; the person must be a contact OF that account (the same
// rule the screen enforces). Nothing is sent to anyone, and the private note is not importable.

export async function POST(request: NextRequest) {
  let supabase, tenantId, userId;
  try {
    ({ supabase, tenantId, userId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const gate = await assertObjectFeature(tenantId, "abm_members");
  if (gate) return gate;

  const rows = readImportBody(await request.json());
  if (!rows) return NextResponse.json({ error: "No rows provided" }, { status: 400 });

  const [fieldConfig, salesConfig, programs, accounts, targets, contacts] = await Promise.all([
    getEffectiveFieldConfig(supabase, tenantId, "abm_member"),
    getSalesConfig(supabase, tenantId),
    fetchAllRows<{ id: string; ref: string | null }>(supabase, "abm_programs", "id, ref", tenantId),
    fetchAllRows<{ id: string; name: string }>(supabase, "accounts", "id, name", tenantId),
    fetchAllRows<{ id: string; program_id: string; account_id: string }>(supabase, "abm_target_accounts", "id, program_id, account_id", tenantId),
    fetchAllRows<{ id: string; name: string; account_id: string }>(supabase, "contacts", "id, name, account_id", tenantId),
  ]);
  const spec = buildObjectSpec("abm_members", fieldConfig, salesConfig);
  const programByRef = new Map(programs.filter((p) => p.ref).map((p) => [String(p.ref).toUpperCase(), p.id]));
  const accountByName = new Map(accounts.map((a) => [nameKey(a.name), a.id]));
  const targetByKey = new Map(targets.map((t) => [`${t.program_id}|${t.account_id}`, t.id]));
  const contactByKey = new Map(contacts.map((x) => [`${x.account_id}|${nameKey(x.name)}`, x.id]));

  const prepared: PreparedRow[] = [];
  const outcomes: RowOutcome[] = [];

  for (const { rowNum, values } of rows) {
    const validated = validateRow(spec, values, rowNum);
    if (hasBlockingIssue(validated)) {
      outcomes.push({ rowNum, status: "failed", reason: validated.issues.filter((i) => i.severity === "error").map((i) => i.message).join("; ") });
      continue;
    }
    const v = validated.values;
    const programId = programByRef.get(String(v.program_ref ?? "").trim().toUpperCase());
    if (!programId) { outcomes.push({ rowNum, status: "failed", reason: `Program "${v.program_ref}" was not found — check the Program ID` }); continue; }
    const accountId = accountByName.get(nameKey(v.account_name ?? ""));
    if (!accountId) { outcomes.push({ rowNum, status: "failed", reason: `Account "${v.account_name}" was not found` }); continue; }
    const targetId = targetByKey.get(`${programId}|${accountId}`);
    if (!targetId) { outcomes.push({ rowNum, status: "failed", reason: `${v.account_name} is not a target account in ${v.program_ref} — import target accounts first` }); continue; }
    const contactId = contactByKey.get(`${accountId}|${nameKey(v.contact_name ?? "")}`);
    if (!contactId) { outcomes.push({ rowNum, status: "failed", reason: `"${v.contact_name}" is not a contact of ${v.account_name}` }); continue; }
    let roleValue: unknown = "unknown";
    if (v.role) {
      const n = NORMALISE.role(v.role);
      if (!n.ok) { outcomes.push({ rowNum, status: "failed", reason: n.reason }); continue; }
      roleValue = n.value;
    }
    const custom = collectCustomData(values);
    prepared.push({
      rowNum,
      record: {
        tenant_id: tenantId, target_account_id: targetId, contact_id: contactId, role: roleValue,
        is_primary: false, added_by: userId, added_via: "import", ...(custom ? { custom_data: custom } : {}),
      },
    });
  }

  if (prepared.length === 0) return NextResponse.json(summarise(outcomes));
  const user = await getAuthUser();
  return NextResponse.json(await insertRows(supabase, "abm_buying_group_members", prepared, outcomes, {
    objectType: "abm_buying_group_members", labelField: "contact_id", actorId: user?.id, actorEmail: user?.email,
  }));
}
