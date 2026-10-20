import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, getAuthUser } from "@/lib/supabase-server";
import { assertObjectFeature } from "@/lib/objectFeatures";
import { readImportBody } from "@/lib/import/server";
import { summariseUpdate, updateRows } from "@/lib/import/updateServer";
import { prepareAbmUpdates } from "@/lib/abm/dw";

// Mirrors the PATCH allowlist of src/app/api/abm/programs/[id]/route.ts minus the owner (a
// relationship is changed on the record) and the required roles. Matches by real id only (section 3).
const ALLOWED = ["name", "kind", "goal", "goal_metric", "goal_target", "starts_on", "ends_on", "default_tier", "status"] as const;

export async function POST(request: NextRequest) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const gate = await assertObjectFeature(tenantId, "abm_programs");
  if (gate) return gate;

  const rows = readImportBody(await request.json());
  if (!rows) return NextResponse.json({ error: "No rows provided" }, { status: 400 });

  const { prepared, outcomes } = await prepareAbmUpdates(supabase, tenantId, "abm_programs", ALLOWED, rows);
  if (prepared.length === 0) return NextResponse.json(summariseUpdate(outcomes));
  const user = await getAuthUser();
  return NextResponse.json(await updateRows(supabase, "abm_programs", tenantId, prepared, outcomes, {
    objectType: "abm_programs", labelField: "name", actorId: user?.id, actorEmail: user?.email,
  }));
}
