import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { runPull, runPushFenceProjects } from "@/lib/connectors/d365/server";
import { D365_ENTITY_KEYS, type D365EntityKey } from "@/lib/connectors/d365/types";

// POST { entity, full?: boolean }             -- pull one entity now
// POST { entity: "fence_projects", ids?: [] }  -- push fence projects now
// Admin only. A pull is incremental from the last successful run unless
// `full` asks for everything again.
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  let tenantId: string, userId: string;
  try {
    const a = await requireTenantUser();
    if (a.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    ({ tenantId, userId } = a);
  } catch (e) {
    const x = e as { status?: number; message?: string };
    return NextResponse.json({ error: x.message ?? "Unauthorized" }, { status: x.status ?? 401 });
  }
  const body = (await req.json().catch(() => ({}))) as { entity?: string; full?: boolean; ids?: string[] };
  const entity = body.entity as D365EntityKey;
  if (!D365_ENTITY_KEYS.includes(entity)) return NextResponse.json({ error: "Unknown entity" }, { status: 422 });
  const admin = createAdminSupabase();
  const res = entity === "fence_projects"
    ? await runPushFenceProjects(admin, tenantId, { trigger: "manual", userId, ids: Array.isArray(body.ids) ? body.ids.filter((x) => typeof x === "string").slice(0, 500) : undefined })
    : await runPull(admin, tenantId, entity, { trigger: "manual", userId, full: body.full === true });
  return NextResponse.json(res, { status: res.error ? 400 : 200 });
}
