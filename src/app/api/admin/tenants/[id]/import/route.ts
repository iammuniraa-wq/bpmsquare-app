import { NextResponse, type NextRequest } from "next/server";
import { isPlatformAdmin } from "@/lib/tenant";
import { createAdminSupabase } from "@/lib/supabase-server";
import { TENANT_TABLES } from "@/lib/tenantExport";

/**
 * Platform-admin-only counterpart to the export route: takes an export file's
 * JSON body and inserts every row into THIS tenant, remapping tenant_id.
 * Row ids are preserved verbatim so cross-table FKs (quote -> lines, case ->
 * photos, ...) survive -- which makes this suitable for cloning a tenant into
 * an EMPTY target (the staging dev tenant, a new demo sandbox), not for
 * merging into a tenant that already has data. Inserts are upserts with
 * ignoreDuplicates, so re-running the same file is a no-op rather than a
 * duplicate-key explosion.
 *
 * Encrypted PII columns are copied as ciphertext -- they decrypt on the
 * target only if it shares the source's FIELD_ENCRYPTION_KEY (true for our
 * staging setup, which reuses the production key).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const isAdmin = await isPlatformAdmin();
  if (!isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const admin = createAdminSupabase();

  const { data: tenant } = await admin.from("tenants").select("id, name").eq("id", id).maybeSingle();
  if (!tenant) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });

  let body: { data?: Record<string, Record<string, unknown>[]> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be the JSON produced by the export" }, { status: 400 });
  }
  const data = body?.data;
  if (!data || typeof data !== "object") {
    return NextResponse.json({ error: "Missing data — upload the JSON file the export produced" }, { status: 400 });
  }

  const CHUNK = 400;
  const summary: Record<string, number> = {};
  const errors: Record<string, string> = {};
  // service_cases.parent_case_id is a self-FK; a child can precede its parent
  // within the batch, so it's stripped on insert and patched afterwards.
  const casesParentPatch: { id: string; parent_case_id: string }[] = [];

  for (const table of TENANT_TABLES) {
    const rows = data[table];
    if (!Array.isArray(rows) || rows.length === 0) continue;

    const prepared = rows.map((r) => {
      const row: Record<string, unknown> = { ...r, tenant_id: tenant.id };
      if (table === "service_cases" && row.parent_case_id) {
        casesParentPatch.push({ id: String(row.id), parent_case_id: String(row.parent_case_id) });
        row.parent_case_id = null;
      }
      return row;
    });

    let inserted = 0;
    for (let i = 0; i < prepared.length; i += CHUNK) {
      const chunk = prepared.slice(i, i + CHUNK);
      const { error } = await admin.from(table).upsert(chunk, { onConflict: "id", ignoreDuplicates: true });
      if (error) {
        errors[table] = error.message;
        break;
      }
      inserted += chunk.length;
    }
    summary[table] = inserted;
  }

  for (const patch of casesParentPatch) {
    await admin.from("service_cases")
      .update({ parent_case_id: patch.parent_case_id })
      .eq("id", patch.id)
      .eq("tenant_id", tenant.id);
  }

  const total = Object.values(summary).reduce((s, n) => s + n, 0);
  return NextResponse.json({
    ok: Object.keys(errors).length === 0,
    tenant: tenant.name,
    totalRows: total,
    tables: summary,
    ...(Object.keys(errors).length > 0 ? { errors } : {}),
  });
}
