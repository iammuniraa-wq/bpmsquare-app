import { NextResponse, type NextRequest } from "next/server";
import { loadMarketingSettingsContext } from "@/lib/marketing/settingsServer";
import { marketingConfigOf } from "@/lib/marketing/config";
import { rubricChanged, rubricOf, sanitizeRubric, PROFILE_FIELDS } from "@/lib/marketing/scoring";
import { EVENTS } from "@/lib/events/catalog";

// Settings -> Marketing -> Leads -> Scoring. Admin-only, and a 404 for any workspace
// without the marketing_scoring program. The rubric is validated here, not
// trusted from the page: unknown events and fields are dropped, numbers are
// clamped, and the version is the server's to bump.

export async function GET() {
  const g = await loadMarketingSettingsContext();
  if (!g.ok) return g.response;
  const saved = marketingConfigOf(g.ctx.config).scoring;
  return NextResponse.json({
    rubric: rubricOf(saved),
    customised: !!saved,
    events: Object.values(EVENTS),
    profile_fields: PROFILE_FIELDS,
  });
}

export async function PUT(request: NextRequest) {
  const g = await loadMarketingSettingsContext();
  if (!g.ok) return g.response;
  const { admin, tenantId, config } = g.ctx;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  const current = rubricOf(marketingConfigOf(config).scoring);
  const next = sanitizeRubric((body as { rubric?: unknown }).rubric, current.version);
  if (next.behaviour.length === 0 && next.profile.length === 0) {
    return NextResponse.json({ error: "Add at least one scoring rule" }, { status: 400 });
  }
  if (rubricChanged(next, current)) next.version = current.version + 1;

  const marketing = { ...marketingConfigOf(config), scoring: next };
  const { error } = await admin.from("tenants").update({ config: { ...config, marketing } }).eq("id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rubric: next });
}
