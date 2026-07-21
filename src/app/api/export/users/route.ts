import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { applyFilters } from "@/lib/import/exportServer";
import type { ExportFilter, ExportResponse } from "@/lib/import/types";

type AdminClient = ReturnType<typeof createAdminSupabase>;

const AUTH_PAGE_SIZE = 1000;

async function buildAuthUserIndex(admin: AdminClient): Promise<Map<string, { email: string; name: string }>> {
  const index = new Map<string, { email: string; name: string }>();
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: AUTH_PAGE_SIZE });
    if (error || !data?.users?.length) break;
    for (const user of data.users) {
      index.set(user.id, {
        email: user.email ?? "",
        name: (user.user_metadata as { full_name?: string } | null)?.full_name ?? "",
      });
    }
    if (data.users.length < AUTH_PAGE_SIZE) break;
  }
  return index;
}

export async function POST(request: NextRequest) {
  let tenantId;
  try {
    ({ tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { filters = [] } = (await request.json()) as { filters?: ExportFilter[] };

  const admin = createAdminSupabase();
  const [{ data: members }, authIndex] = await Promise.all([
    admin.from("tenant_users").select("user_id, role").eq("tenant_id", tenantId),
    buildAuthUserIndex(admin),
  ]);

  const rows = (members ?? []).map((m: { user_id: string; role: string }) => {
    const auth = authIndex.get(m.user_id);
    return {
      id: m.user_id,
      name: auth?.name ?? "",
      email: auth?.email ?? "",
      role: m.role,
    };
  });

  const typeByKey = new Map<string, string>([["name", "text"], ["email", "email"], ["role", "enum"]]);
  const filtered = applyFilters(rows, filters, typeByKey);

  return NextResponse.json({ rows: filtered } satisfies ExportResponse);
}
