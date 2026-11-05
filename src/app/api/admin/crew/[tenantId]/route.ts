import { NextResponse, type NextRequest } from "next/server";
import { isPlatformAdmin } from "@/lib/tenant";
import { createAdminSupabase } from "@/lib/supabase-server";
import { AGENTS } from "@/lib/crew/registry";
import { agentTokensUsed, loadSettings, saveSettings } from "@/lib/crew/server/store";
import { getAuthUser } from "@/lib/supabase-server";

// GET / PUT /api/admin/crew/[tenantId] -- platform admin only (/admin/tenants). The two things a workspace admin must NOT set:
//   - each agent's monthly token cap (owner decision 2026-11-04: 600,000 Tender Watch, 500,000 Attendance, on top of the pooled allowance);
//   - the shadow-period visibility: "admins" (default) or "deal_teams" (the people a finding was addressed to may see it too).
// The tenant id here is the one being edited, taken from the path of a platform-admin-only route, never from a workspace session.

const UUID = /^[0-9a-f-]{36}$/i;

async function gate(): Promise<NextResponse | null> {
  if (!(await isPlatformAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return null;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const denied = await gate();
  if (denied) return denied;
  const { tenantId } = await params;
  if (!UUID.test(tenantId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const admin = createAdminSupabase();
  const settings = await loadSettings(admin, tenantId);
  if (settings.pending) return NextResponse.json({ pending: true, agents: [] });
  const agents = await Promise.all(AGENTS.map(async (a) => {
    const s = settings.get(a.key);
    return { key: a.key, name: a.name, enabled: s.enabled, cap: s.monthly_token_cap, defaultCap: a.defaults.monthlyTokenCap, visibility: s.config.visibility ?? "admins", used: await agentTokensUsed(admin, tenantId, a.key) };
  }));
  return NextResponse.json({ pending: false, agents });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const denied = await gate();
  if (denied) return denied;
  const { tenantId } = await params;
  if (!UUID.test(tenantId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = (await request.json().catch(() => null)) as { agents?: { key?: unknown; cap?: unknown; visibility?: unknown }[] } | null;
  if (!body || !Array.isArray(body.agents)) return NextResponse.json({ error: "agents is required" }, { status: 400 });
  const admin = createAdminSupabase();
  const { data: t } = await admin.from("tenants").select("id").eq("id", tenantId).maybeSingle();
  if (!t) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const user = await getAuthUser();
  const current = await loadSettings(admin, tenantId);
  if (current.pending) return NextResponse.json({ error: "AI automation needs a database update (migration 0245)." }, { status: 503 });

  for (const a of body.agents) {
    const entry = AGENTS.find((x) => x.key === a.key);
    if (!entry) return NextResponse.json({ error: "Unknown agent" }, { status: 400 });
    const cap = a.cap === null || a.cap === "" ? null : Number(a.cap);
    if (cap !== null && !(Number.isFinite(cap) && cap >= 0 && cap <= 1_000_000_000)) return NextResponse.json({ error: "The cap must be a whole number of tokens" }, { status: 400 });
    const visibility = a.visibility === "deal_teams" ? "deal_teams" : "admins";
    const cur = current.get(entry.key);
    const r = await saveSettings(admin, tenantId, entry.key, user?.id ?? "", { monthly_token_cap: cap === null ? null : Math.floor(cap), config: { ...cur.config, visibility } });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
