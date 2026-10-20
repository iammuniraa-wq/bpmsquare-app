import { NextResponse, type NextRequest } from "next/server";
import { moduleAccess, moduleErrorResponse } from "@/lib/marketing/moduleAccess";
import { WHATSAPP_SPEC } from "@/lib/marketing/whatsapp/server";

// GET /api/whatsapp/lookup?q= -- people of this workspace by name, for the "send a test" picker.
// Names, company and ids only: never a phone number or an email.

const clean = (s: string) => s.replace(/[,()%*\\]/g, " ").trim().slice(0, 60);

export async function GET(req: NextRequest) {
  try {
    const ctx = await moduleAccess(WHATSAPP_SPEC, "view");
    const q = clean(req.nextUrl.searchParams.get("q") ?? "");
    if (q.length < 2) return NextResponse.json({ items: [] });
    const { data } = await ctx.supabase.from("contacts").select("id, name, account_id").eq("tenant_id", ctx.tenantId).ilike("name", `%${q}%`).order("name").limit(15);
    const rows = (data ?? []) as { id: string; name: string; account_id: string }[];
    const ids = [...new Set(rows.map((r) => r.account_id))];
    const accts = ids.length ? await ctx.supabase.from("accounts").select("id, name").eq("tenant_id", ctx.tenantId).in("id", ids) : { data: [] };
    const aName = new Map(((accts.data ?? []) as { id: string; name: string }[]).map((a) => [a.id, a.name]));
    return NextResponse.json({ items: rows.map((r) => ({ id: r.id, name: r.name, company: aName.get(r.account_id) ?? "" })) });
  } catch (e) {
    return moduleErrorResponse(WHATSAPP_SPEC, e);
  }
}
