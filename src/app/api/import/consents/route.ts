import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase, getAuthUser } from "@/lib/supabase-server";
import { assertObjectFeature } from "@/lib/objectFeatures";
import { readImportBody, summarise } from "@/lib/import/server";
import { logChangeBatch } from "@/lib/changeLog";
import { resolvePermissions, canEditWorkcenter } from "@/lib/permissions";
import { cleanFileName, importConsents, MAX_CONSENT_IMPORT_ROWS } from "@/lib/marketing/consentImport";
import type { TenantFeatures } from "@/lib/constants";

export const maxDuration = 60;

/**
 * Imports a sheet of opt-ins and withdrawals into the consent ledger (append-only).
 * Each row is matched to an EXISTING contact of this workspace by email (blind index,
 * tenant-scoped); an unmatched row is reported and skipped, never created. Every answer
 * is stored with source "import", its basis and the FILE NAME as evidence. See
 * src/lib/marketing/consentImport.ts for the rules.
 */
export async function POST(request: NextRequest) {
  let supabase, tenantId, userId, role;
  try {
    ({ supabase, tenantId, userId, role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  // A tenant without the module cannot read or write its data in bulk
  // either -- the gate is the same question the nav and the v1 API ask.
  const gate = await assertObjectFeature(tenantId, "consents");
  if (gate) return gate;
  const admin = createAdminSupabase();
  const { data: tenantRow } = await admin.from("tenants").select("features").eq("id", tenantId).maybeSingle();
  if ((tenantRow?.features as Partial<TenantFeatures> | undefined)?.marketing !== true) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!canEditWorkcenter(await resolvePermissions(supabase, tenantId, userId, role), "contacts")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const rows = readImportBody(body);
  if (!rows) return NextResponse.json({ error: "No rows provided" }, { status: 400 });
  if (rows.length > MAX_CONSENT_IMPORT_ROWS) {
    return NextResponse.json({ error: `Import at most ${MAX_CONSENT_IMPORT_ROWS} rows at a time.` }, { status: 400 });
  }
  // The file name is the evidence for every answer in it, so it is required.
  const fileName = cleanFileName((body as { fileName?: unknown } | null)?.fileName);
  if (!fileName) return NextResponse.json({ error: "The file name is missing. Upload the file again so each answer can be traced back to it." }, { status: 400 });

  const { outcomes, changeLog } = await importConsents(admin, tenantId, userId, rows, fileName);

  if (changeLog.length > 0) {
    const user = await getAuthUser();
    await logChangeBatch(supabase, changeLog.map((c) => ({ ...c, actorId: user?.id, actorEmail: user?.email })));
  }
  return NextResponse.json(summarise(outcomes));
}
