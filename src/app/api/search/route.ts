import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { globalSearch } from "@/lib/data";
import { getSearchObject, type SearchObjectType } from "@/lib/globalSearch";

export async function GET(request: NextRequest) {
  let tenantId;
  try {
    ({ tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") ?? "";
  const typeParam = searchParams.get("type") ?? undefined;
  const objectType = typeParam && getSearchObject(typeParam) ? (typeParam as SearchObjectType) : undefined;

  const results = await globalSearch(tenantId, q, objectType);
  return NextResponse.json({ results });
}
