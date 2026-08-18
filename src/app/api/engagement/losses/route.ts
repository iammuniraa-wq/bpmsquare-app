import { NextResponse } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";
import { LOSS_REASONS, type LossReason } from "@/lib/constants";

/**
 * Loss Intelligence — engagement layer. Aggregates the last 12 months of
 * lost/dropped quotations by their structured loss_reason: the mix (count
 * and value share), the most recent losses with their notes, and how many
 * older losses have no reason filed yet. Computed live on every call;
 * nothing cached, nothing stored here.
 */
export async function GET() {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (!(await tenantHasFeature(supabase, tenantId, "quotations"))) {
    return NextResponse.json({ error: "Quotations isn't enabled for your workspace" }, { status: 403 });
  }

  const since = new Date();
  since.setFullYear(since.getFullYear() - 1);

  const { data, error } = await supabase
    .from("quotes")
    .select("id, ref, total, outcome, loss_reason, loss_note, closed_at, updated_at, account_id")
    .eq("tenant_id", tenantId)
    .in("outcome", ["lost", "dropped"])
    .gte("updated_at", since.toISOString())
    .order("updated_at", { ascending: false });
  if (error) {
    // Column not migrated yet (0088) -- degrade to "nothing to show".
    return NextResponse.json({ mix: [], recent: [], total_value: 0, unfiled: 0 });
  }

  const rows = data ?? [];
  const accountIds = [...new Set(rows.map((q) => q.account_id).filter(Boolean))];
  const { data: accounts } = accountIds.length
    ? await supabase.from("accounts").select("id, name").eq("tenant_id", tenantId).in("id", accountIds)
    : { data: [] };
  const nameById = new Map((accounts ?? []).map((a) => [a.id as string, a.name as string]));

  const mixMap = new Map<string, { count: number; value: number }>();
  let unfiled = 0;
  let totalValue = 0;
  for (const q of rows) {
    totalValue += q.total ?? 0;
    const r = q.loss_reason as LossReason | null;
    if (!r) { unfiled++; continue; }
    const cur = mixMap.get(r) ?? { count: 0, value: 0 };
    cur.count++; cur.value += q.total ?? 0;
    mixMap.set(r, cur);
  }
  const mix = LOSS_REASONS
    .map((r) => ({ reason: r, ...(mixMap.get(r) ?? { count: 0, value: 0 }) }))
    .filter((m) => m.count > 0);

  const recent = rows.slice(0, 4).map((q) => ({
    id: q.id, ref: q.ref, total: q.total, outcome: q.outcome,
    reason: q.loss_reason ?? null, note: q.loss_note ?? null,
    account_name: nameById.get(q.account_id) ?? null,
    when: q.closed_at ?? q.updated_at,
  }));

  return NextResponse.json({ mix, recent, total_value: totalValue, unfiled });
}
