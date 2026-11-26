import { NextResponse, type NextRequest } from "next/server";
import { logChange } from "@/lib/changeLog";
import { getAuthUser } from "@/lib/supabase-server";
import { getTenant } from "@/lib/tenant";
import { isMissingSchema, loadProject, needsUpdate, openProjectRequest } from "@/lib/contractProjects/server";
import { canSeeProjectFinance } from "@/lib/projectFinance/access";
import { parseEtgEntries, unknownCells } from "@/lib/projectFinance/etg";
import { FORECAST_BUNDLE, getProjectFinance, resolveFinanceAccess } from "@/lib/projectFinance/server";

// GET /api/contract-projects/[id]/forecast
//        -> { finance, labels, buyout_packages, etg_missing }  the cost and margin of the project: the cells, the figures, the lights.
// PUT /api/contract-projects/[id]/forecast  { entries: [{ wbs_code, resource_code, amount: number | null, note? }] }
//        Types (or, with amount null, clears) the estimate to go of cost cells that the approved budget has. Edits are logged on the project.
// Cost and margin are internal: the same 404 as a project that does not exist for anyone who may not see them (workspace setting
// finance_visibility), and a workspace without the module sees nothing. Never on the v1 API, MCP, Data Workbench or the change feed.
// While migration 0261 is pending a PUT answers 503 with needsDatabaseUpdate; the GET still answers.

type Ctx = { params: Promise<{ id: string }> };

async function open(request: { write: boolean }, id: string) {
  const gate = await openProjectRequest({ write: request.write });
  if (!gate.ok) return { ok: false, res: NextResponse.json({ error: gate.error }, { status: gate.status }) } as const;
  const found = await loadProject(gate.req.admin, gate.req.tenantId, id);
  if (found.kind === "pending") return { ok: false, res: NextResponse.json({ error: needsUpdate().error, needsDatabaseUpdate: true }, { status: 503 }) } as const;
  if (found.kind !== "ok") return { ok: false, res: NextResponse.json({ error: "Not found" }, { status: 404 }) } as const;
  const tenant = await getTenant();
  const req = gate.req;
  const access = await resolveFinanceAccess({ supabase: req.supabase, tenantId: req.tenantId, userId: req.userId, role: req.role, features: tenant?.features, config: tenant?.config });
  // Not allowed reads as "not found": a person who may not see cost cannot tell the screen exists.
  if (!canSeeProjectFinance(access.caller, found.project, req.userId)) return { ok: false, res: NextResponse.json({ error: "Not found" }, { status: 404 }) } as const;
  return { ok: true, req, project: found.project, access, features: tenant?.features } as const;
}

export async function GET(_request: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const o = await open({ write: false }, id);
  if (!o.ok) return o.res;
  const detail = await getProjectFinance({ admin: o.req.admin, tenantId: o.req.tenantId, userId: o.req.userId, access: o.access, features: o.features, project: o.project });
  if (!detail) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ finance: detail.finance, labels: detail.labels, buyout_packages: detail.buyoutPackages, etg_missing: detail.etgMissing });
}

export async function PUT(request: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const o = await open({ write: true }, id);
  if (!o.ok) return o.res;
  const { req, project } = o;
  if (project.status === "closed") return NextResponse.json({ error: "This project is closed" }, { status: 409 });
  const body = await request.json().catch(() => null);
  const parsed = parseEtgEntries(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });

  const detail = await getProjectFinance({ admin: req.admin, tenantId: req.tenantId, userId: req.userId, access: o.access, features: o.features, project });
  if (!detail) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (detail.etgMissing) return NextResponse.json({ error: "Saving an estimate needs a database update (migration 0261). Ask your administrator to apply it.", needsDatabaseUpdate: true, bundle: FORECAST_BUNDLE }, { status: 503 });
  const f = detail.finance;
  if (!f.baselineApproved) return NextResponse.json({ error: "The forecast starts once the first budget is approved" }, { status: 409 });
  const known = new Set(f.cost.cells.map((c) => c.key));
  const bad = unknownCells(parsed.entries, known);
  if (bad.length > 0) return NextResponse.json({ error: "One of those rows is not part of the approved budget" }, { status: 422 });

  const before = new Map(f.etg.map((e) => [`${e.wbs_code}|${e.resource_code}`, e.amount]));
  const user = await getAuthUser();
  const now = new Date().toISOString();
  const changes: { field: string; from: unknown; to: unknown }[] = [];
  const label = (e: { wbs_code: string; resource_code: string }) => `${detail.labels.resource[e.resource_code] ?? (e.resource_code || "No resource type")}${e.wbs_code ? `, ${e.wbs_code}` : ""}`;

  for (const e of parsed.entries) {
    const was = before.get(`${e.wbs_code}|${e.resource_code}`) ?? null;
    if (e.amount === null) {
      if (was === null) continue;
      const del = await req.admin.from("project_forecast_etg").delete().eq("tenant_id", req.tenantId).eq("project_id", project.id).eq("wbs_code", e.wbs_code).eq("resource_code", e.resource_code);
      if (del.error) return failure(del.error);
    } else {
      if (was === e.amount) continue;
      const up = await req.admin.from("project_forecast_etg").upsert(
        { tenant_id: req.tenantId, project_id: project.id, wbs_code: e.wbs_code, resource_code: e.resource_code, amount: e.amount, note: e.note, entered_by: req.userId, entered_at: now },
        { onConflict: "project_id,wbs_code,resource_code" },
      );
      if (up.error) return failure(up.error);
    }
    // "Forecast ..." fields are internal by name: the change feed strips them (src/lib/api/changeFeedScope.ts).
    changes.push({ field: `Forecast estimate to go (${label(e)})`, from: was, to: e.amount });
  }
  if (changes.length > 0) {
    await logChange(req.supabase, {
      tenantId: req.tenantId, objectType: "contract_projects", objectId: project.id, objectLabel: [project.ref, project.name].filter(Boolean).join(" "),
      action: "update", actorId: user?.id, actorEmail: user?.email, changes,
    });
  }
  return NextResponse.json({ ok: true, changed: changes.length });
}

function failure(error: { code?: string; message: string }) {
  if (isMissingSchema(error)) return NextResponse.json({ error: "Saving an estimate needs a database update (migration 0261). Ask your administrator to apply it.", needsDatabaseUpdate: true, bundle: FORECAST_BUNDLE }, { status: 503 });
  return NextResponse.json({ error: "Couldn't save the forecast" }, { status: 500 });
}
