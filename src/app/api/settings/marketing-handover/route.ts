import { NextResponse, type NextRequest } from "next/server";
import { loadMarketingSettingsContext } from "@/lib/marketing/settingsServer";
import { marketingConfigOf } from "@/lib/marketing/config";
import { handoverOf, mergeLifecycle, sanitizeHandover } from "@/lib/marketing/leads/handover";
import { listWorkspacePeople, personLabel } from "@/lib/marketing/leads/people";

// Settings -> Marketing -> Leads -> Hand-over. Admin-only, and a 404 for any workspace without the
// marketing_scoring program (loadMarketingSettingsContext). The tenant is the one that call returns;
// nothing in the body names one. People are checked against tenant_users of THIS workspace before they
// are stored, so an id from the request cannot put someone else's person on the rota. No secrets live
// here, so nothing needs redacting for a non-admin: a non-admin never reaches this route.

export async function GET() {
  const g = await loadMarketingSettingsContext();
  if (!g.ok) return g.response;
  const { admin, tenantId, config, features } = g.ctx;
  const people = await listWorkspacePeople(admin, tenantId);

  // The result of Coverage's per-team choice, shown read-only on the screen; the choice itself stays on the team.
  let teams: { in_turn: number; team_lead: number } | null = null;
  if (features.coverage_model === true) {
    const { data, error } = await admin.from("teams").select("assignment_mode").eq("tenant_id", tenantId);
    if (!error) {
      const modes = ((data ?? []) as { assignment_mode: string | null }[]).map((t) => t.assignment_mode);
      teams = { in_turn: modes.filter((m) => m === "round_robin").length, team_lead: modes.filter((m) => m !== "round_robin").length };
    }
  }
  return NextResponse.json({
    settings: handoverOf(config),
    people: people.map((p) => ({ user_id: p.user_id, label: personLabel(p) })),
    coverage: features.coverage_model === true,
    teams,
  });
}

export async function PUT(request: NextRequest) {
  const g = await loadMarketingSettingsContext();
  if (!g.ok) return g.response;
  const { admin, tenantId, config } = g.ctx;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  const { data: rows, error: mErr } = await admin.from("tenant_users").select("user_id").eq("tenant_id", tenantId);
  if (mErr) return NextResponse.json({ error: "Could not check your team" }, { status: 500 });
  const members = new Set(((rows ?? []) as { user_id: string }[]).map((r) => r.user_id));

  const checked = sanitizeHandover(body, members);
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });

  const current = marketingConfigOf(config);
  const marketing = { ...current, lifecycle: mergeLifecycle(current.lifecycle, checked.value) };
  const { error } = await admin.from("tenants").update({ config: { ...config, marketing } }).eq("id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ settings: checked.value });
}
