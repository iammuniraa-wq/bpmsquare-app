import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, getAuthUser } from "@/lib/supabase-server";
import { assertObjectFeature } from "@/lib/objectFeatures";
import { readImportBody } from "@/lib/import/server";
import { summariseUpdate, updateRows } from "@/lib/import/updateServer";
import { prepareAbmUpdates } from "@/lib/abm/dw";

// Mirrors the PATCH allowlist of src/app/api/abm/targets/[id]/route.ts for the plain columns only.
// Progress is deliberately NOT here: a manual change needs a reason and records who made it, so it
// is made on the screen. Owner and deal are relationships and change on the record. Matches by real id.
const ALLOWED = ["tier", "next_step", "next_step_due"] as const;

export async function POST(request: NextRequest) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const gate = await assertObjectFeature(tenantId, "abm_targets");
  if (gate) return gate;

  const rows = readImportBody(await request.json());
  if (!rows) return NextResponse.json({ error: "No rows provided" }, { status: 400 });

  const { prepared, outcomes } = await prepareAbmUpdates(supabase, tenantId, "abm_target_accounts", ALLOWED, rows);
  if (prepared.length === 0) return NextResponse.json(summariseUpdate(outcomes));
  const user = await getAuthUser();
  return NextResponse.json(await updateRows(supabase, "abm_target_accounts", tenantId, prepared, outcomes, {
    objectType: "abm_target_accounts", labelField: "id", actorId: user?.id, actorEmail: user?.email,
  }));
}
