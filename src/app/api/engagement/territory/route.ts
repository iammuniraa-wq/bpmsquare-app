import { NextResponse } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";
import { getSalesConfig } from "@/lib/fieldConfig";

/**
 * Fog of War — engagement layer. The map's universe is the tenant's OWN
 * territory picklist (Settings → Sales config), so nothing geographic is
 * hardcoded and any tenant's map is exactly the territories they said they
 * sell in. A territory is "discovered" the moment it has an account; the
 * discovery credit is the territory's earliest account and its date.
 * Computed live from accounts on every call — nothing stored.
 */
export async function GET() {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (!(await tenantHasFeature(supabase, tenantId, "accounts"))) {
    return NextResponse.json({ error: "Accounts isn't enabled for your workspace" }, { status: 403 });
  }

  const [salesConfig, { data: accounts }] = await Promise.all([
    getSalesConfig(supabase, tenantId),
    supabase.from("accounts").select("name, territory, created_at").eq("tenant_id", tenantId),
  ]);

  const territories = salesConfig.territories ?? [];
  // A map needs somewhere to explore: with fewer than 2 configured
  // territories there is no fog worth drawing, and the card stays hidden.
  if (territories.length < 2) return NextResponse.json({ cells: [] });

  // Accounts store the territory CODE; hexes display the name.
  const codes = new Set(territories.map((t) => t.code));
  const byTerritory = new Map<string, { count: number; first: { name: string; at: string } | null }>();
  for (const a of accounts ?? []) {
    if (!a.territory || !codes.has(a.territory)) continue;
    const cur = byTerritory.get(a.territory) ?? { count: 0, first: null };
    cur.count++;
    if (!cur.first || a.created_at < cur.first.at) cur.first = { name: a.name, at: a.created_at };
    byTerritory.set(a.territory, cur);
  }

  const cells = territories.map((t) => {
    const hit = byTerritory.get(t.code);
    return {
      territory: t.name,
      count: hit?.count ?? 0,
      first_account: hit?.first?.name ?? null,
      first_at: hit?.first?.at ?? null,
    };
  });

  return NextResponse.json({ cells });
}
