import { NextResponse, type NextRequest } from "next/server";
import { abmAccess, errorResponse, isMissingRelation, pendingResponse, isTenantMember, PROGRAM_COLUMNS } from "@/lib/abm/server";
import { parseProgram } from "@/lib/abm/requests";
import { DEFAULT_REQUIRED_ROLES, type AbmProgram } from "@/lib/abm/types";
import { insertWithMasterRef } from "@/lib/masterRef";
import { diffForLog, logChange } from "@/lib/changeLog";
import { emitEvent } from "@/lib/events/emit";
import { EVENTS } from "@/lib/events/catalog";

// ABM programs (0180, docs/abm-architecture.md).
//
// GET  /api/abm/programs?status=&q=   -> { programs, pending_migration? }
// POST /api/abm/programs { name, kind?, goal?, goal_metric?, goal_target?, starts_on?, ends_on?,
//                          owner_user_id?, default_tier?, required_roles? }   -> 201 program

export async function GET(req: NextRequest) {
  try {
    const ctx = await abmAccess("view");
    const sp = req.nextUrl.searchParams;
    let q = ctx.supabase.from("abm_programs").select(PROGRAM_COLUMNS).eq("tenant_id", ctx.tenantId).order("created_at", { ascending: false }).limit(500);
    const status = sp.get("status");
    if (status) q = q.eq("status", status);
    const { data, error } = await q;
    if (error) {
      if (isMissingRelation(error)) return NextResponse.json({ programs: [], pending_migration: true });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const term = (sp.get("q") ?? "").trim().toLowerCase();
    const rows = ((data ?? []) as unknown as AbmProgram[]).filter((p) => !term || `${p.ref ?? ""} ${p.name} ${p.goal ?? ""}`.toLowerCase().includes(term));
    return NextResponse.json({ programs: rows });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await abmAccess("create");
    const parsed = parseProgram(await req.json().catch(() => null), true);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });
    const v = parsed.value;
    if (v.owner_user_id && !(await isTenantMember(ctx, v.owner_user_id))) return NextResponse.json({ error: "The owner must be a member of this workspace." }, { status: 422 });

    const record = {
      tenant_id: ctx.tenantId,
      name: v.name,
      kind: v.kind ?? "new_business",
      goal: v.goal ?? null,
      goal_metric: v.goal_metric ?? "deals_won",
      goal_target: v.goal_target ?? null,
      starts_on: v.starts_on ?? null,
      ends_on: v.ends_on ?? null,
      owner_user_id: v.owner_user_id ?? ctx.userId,
      status: "draft",
      default_tier: v.default_tier ?? "one_to_many",
      required_roles: v.required_roles ?? DEFAULT_REQUIRED_ROLES,
      created_by: ctx.userId,
      ...(v.custom_data ? { custom_data: v.custom_data } : {}),
    };
    const { data, error } = await insertWithMasterRef<AbmProgram>(ctx.supabase, "abm_programs", ctx.tenantId, record, PROGRAM_COLUMNS);
    if (error) {
      if (isMissingRelation(error)) return pendingResponse();
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: "Insert failed" }, { status: 500 });

    await logChange(ctx.supabase, {
      tenantId: ctx.tenantId, objectType: "abm_programs", objectId: data.id, objectLabel: data.name, action: "create",
      actorId: ctx.userId, actorEmail: ctx.email, changes: diffForLog("abm_programs", {}, { name: data.name, kind: data.kind, status: data.status }),
    });
    await emitEvent(ctx.tenantId, { name: EVENTS.ABM_PROGRAM_CREATED, object_type: "abm_program", object_id: data.id, actor_id: ctx.userId, key: `${data.id}:created`, payload: { ref: data.ref, kind: data.kind } }, ctx.admin);
    return NextResponse.json(data, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
