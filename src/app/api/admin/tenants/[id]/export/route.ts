import { NextResponse, type NextRequest } from "next/server";
import { isPlatformAdmin } from "@/lib/tenant";
import { createAdminSupabase } from "@/lib/supabase-server";

import { TENANT_TABLES } from "@/lib/tenantExport";

const TABLES = TENANT_TABLES;

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const isAdmin = await isPlatformAdmin();
  if (!isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const fmt = request.nextUrl.searchParams.get("format") ?? "json";
  const admin = createAdminSupabase();

  // Verify tenant exists
  const { data: tenant } = await admin.from("tenants").select("name, slug").eq("id", id).single();
  if (!tenant) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });

  // Fetch all tables for this tenant
  const result: Record<string, unknown[]> = {};
  for (const table of TABLES) {
    const { data } = await admin.from(table).select("*").eq("tenant_id", id);
    result[table] = data ?? [];
  }

  if (fmt === "csv") {
    // One CSV per table, zipped as plain text with separators
    const lines: string[] = [`# VeveyCRM export — ${tenant.name} (${tenant.slug})`, `# Exported: ${new Date().toISOString()}`, ""];
    for (const [table, rows] of Object.entries(result)) {
      if (rows.length === 0) continue;
      lines.push(`## ${table}`);
      const keys = Object.keys(rows[0] as object);
      lines.push(keys.join(","));
      for (const row of rows) {
        lines.push(keys.map((k) => {
          const v = (row as Record<string, unknown>)[k];
          if (v === null || v === undefined) return "";
          const s = typeof v === "object" ? JSON.stringify(v) : String(v);
          return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
        }).join(","));
      }
      lines.push("");
    }
    return new NextResponse(lines.join("\n"), {
      headers: {
        "content-type": "text/csv",
        "content-disposition": `attachment; filename="${tenant.slug}-export-${Date.now()}.csv"`,
      },
    });
  }

  return new NextResponse(JSON.stringify({ tenant: { name: tenant.name, slug: tenant.slug }, exported_at: new Date().toISOString(), data: result }, null, 2), {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="${tenant.slug}-export-${Date.now()}.json"`,
    },
  });
}
