import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, getAuthUser } from "@/lib/supabase-server";
import { assertObjectFeature } from "@/lib/objectFeatures";
import { readImportBody } from "@/lib/import/server";
import { summariseUpdate, updateRows } from "@/lib/import/updateServer";
import { prepareAbmUpdates } from "@/lib/abm/dw";

// Only the role changes in bulk (the PATCH route's role field). The person, the target and the private
// note are not offered: a person is added or removed on the buying group, and notes never leave the app.
const ALLOWED = ["role"] as const;

export async function POST(request: NextRequest) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const gate = await assertObjectFeature(tenantId, "abm_members");
  if (gate) return gate;

  const rows = readImportBody(await request.json());
  if (!rows) return NextResponse.json({ error: "No rows provided" }, { status: 400 });

  const { prepared, outcomes } = await prepareAbmUpdates(supabase, tenantId, "abm_buying_group_members", ALLOWED, rows);
  if (prepared.length === 0) return NextResponse.json(summariseUpdate(outcomes));
  const user = await getAuthUser();
  return NextResponse.json(await updateRows(supabase, "abm_buying_group_members", tenantId, prepared, outcomes, {
    objectType: "abm_buying_group_members", labelField: "id", actorId: user?.id, actorEmail: user?.email,
  }));
}
