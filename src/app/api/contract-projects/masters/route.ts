import { NextResponse, type NextRequest } from "next/server";
import { diffForLog, logChange } from "@/lib/changeLog";
import { getAuthUser } from "@/lib/supabase-server";
import { ensureMasterSeeds, isMissingSchema, MASTER_COLS, needsUpdate, openProjectRequest } from "@/lib/contractProjects/server";
import { MASTER_KINDS, MASTER_KIND_LABEL, isMasterKind, type MasterFlags, type MasterRow } from "@/lib/contractProjects/types";
import { MASTER_IMPORT_LIMITS } from "@/lib/contractProjects/masters";

// The ERP code lists a budget line points at (migration 0226, erp_masters): resource levels, cost codes, justification reasons, reserve
// types, divisions, job locations. One table for all of them.
//
// GET  /api/contract-projects/masters?summary=1
//        -> { kinds: [{ kind, label, total, active, files, defaults, manual }] }  (what Settings > Contract projects shows: one row per kind)
// GET  /api/contract-projects/masters?kind=cost_code&q=&page=&page_size=&all=1
//        -> { rows: [{ id, kind, code, name, parent_code, flags, source, active }], total, page, page_size }   `all=1` (admin) includes
//           inactive rows; otherwise only active ones, which is what a picker needs.
// POST /api/contract-projects/masters  { kind, code, name, parent_code?, flags? }   admin: add one entry by hand.
// Every query is scoped to the session's workspace; writes are admin-only. The first read seeds the resource levels and the
// justification reasons if the workspace has none (never overwriting an edit).

const CODE = /^[^\s,;"'<>][^,;"'<>]{0,39}$/;

export async function GET(request: NextRequest) {
  const gate = await openProjectRequest();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, tenantId, role } = gate.req;
  const sp = new URL(request.url).searchParams;
  await ensureMasterSeeds(admin, tenantId);

  if (sp.get("summary") === "1") {
    const kinds = [];
    for (const kind of MASTER_KINDS) {
      const { data, error } = await admin.from("erp_masters").select("active, source").eq("tenant_id", tenantId).eq("kind", kind).limit(50_000);
      if (error) return isMissingSchema(error) ? NextResponse.json({ ...needsUpdate().extra, error: needsUpdate().error }, { status: 503 }) : NextResponse.json({ error: error.message }, { status: 500 });
      const rows = (data ?? []) as { active: boolean; source: string }[];
      kinds.push({ kind, label: MASTER_KIND_LABEL[kind], total: rows.length, active: rows.filter((r) => r.active).length, files: rows.filter((r) => r.source === "file").length, defaults: rows.filter((r) => r.source === "default").length, manual: rows.filter((r) => r.source === "manual").length });
    }
    return NextResponse.json({ kinds });
  }

  const kind = sp.get("kind");
  if (!isMasterKind(kind)) return NextResponse.json({ error: "kind is required" }, { status: 400 });
  const pageSize = Math.max(1, Math.min(100, Number(sp.get("page_size")) || 50));
  const page = Math.max(1, Number(sp.get("page")) || 1);
  let q = admin.from("erp_masters").select(MASTER_COLS, { count: "exact" }).eq("tenant_id", tenantId).eq("kind", kind);
  if (!(sp.get("all") === "1" && role === "admin")) q = q.eq("active", true);
  const term = (sp.get("q") ?? "").trim().replace(/[,()%*\\]/g, " ").slice(0, 60);
  if (term) q = q.or(`code.ilike.%${term}%,name.ilike.%${term}%`);
  const { data, error, count } = await q.order("code", { ascending: true }).range((page - 1) * pageSize, page * pageSize - 1);
  if (error) return isMissingSchema(error) ? NextResponse.json({ rows: [], total: 0, page, page_size: pageSize, needsDatabaseUpdate: true }) : NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rows: (data ?? []) as MasterRow[], total: count ?? (data ?? []).length, page, page_size: pageSize });
}

export async function POST(request: NextRequest) {
  const gate = await openProjectRequest({ admin: true });
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, supabase, tenantId } = gate.req;
  await ensureMasterSeeds(admin, tenantId);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  if (!isMasterKind(body.kind)) return NextResponse.json({ error: "Unknown list" }, { status: 400 });
  const code = typeof body.code === "string" ? body.code.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim().slice(0, MASTER_IMPORT_LIMITS.nameLength) : "";
  if (!CODE.test(code)) return NextResponse.json({ error: "Give a code of up to 40 characters, without commas, quotes or semicolons" }, { status: 422 });
  if (!name) return NextResponse.json({ error: "Give it a name" }, { status: 422 });
  const parent = typeof body.parent_code === "string" && body.parent_code.trim() ? body.parent_code.trim().slice(0, 40) : null;
  if (parent === code) return NextResponse.json({ error: "A code cannot be its own parent" }, { status: 422 });
  if (parent) {
    const { data } = await admin.from("erp_masters").select("id").eq("tenant_id", tenantId).eq("kind", body.kind).eq("code", parent).maybeSingle();
    if (!data) return NextResponse.json({ error: "The parent code is not in this list" }, { status: 422 });
  }
  const flags: MasterFlags = {};
  if (body.kind === "resource" && body.flags && typeof body.flags === "object") {
    const f = body.flags as Record<string, unknown>;
    for (const k of ["link_to_inventory", "budget_validation", "revenue_side"] as const) if (f[k] === true) flags[k] = true;
  }
  const { data, error } = await admin.from("erp_masters").insert({ tenant_id: tenantId, kind: body.kind, code, name, parent_code: parent, flags, source: "manual", active: true }).select(MASTER_COLS).single();
  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "That code is already in the list" }, { status: 409 });
    return isMissingSchema(error) ? NextResponse.json({ ...needsUpdate().extra, error: needsUpdate().error }, { status: 503 }) : NextResponse.json({ error: error.message }, { status: 500 });
  }
  const user = await getAuthUser();
  await logChange(supabase, {
    tenantId, objectType: "contract_projects", objectId: (data as MasterRow).id, objectLabel: `${MASTER_KIND_LABEL[body.kind]}: ${code}`, action: "create", actorId: user?.id, actorEmail: user?.email,
    changes: diffForLog("contract_projects", {}, { list: MASTER_KIND_LABEL[body.kind], code, name, parent_code: parent }),
  });
  return NextResponse.json(data, { status: 201 });
}
