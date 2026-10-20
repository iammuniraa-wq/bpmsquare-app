import { NextResponse, type NextRequest } from "next/server";
import { moduleAccess, moduleErrorResponse } from "@/lib/marketing/moduleAccess";
import { EVENTS_SPEC } from "@/lib/marketing/events/server";

// Small pickers for the event screens. Names and ids only: never a phone number or an email.
//
// GET /api/marketing-events/lookup?kind=contacts&q=   people of this workspace by name
//     kind=forms                                       forms that are not archived
//     kind=journeys                                    journeys that are not archived

const clean = (s: string) => s.replace(/[,()%*\\]/g, " ").trim().slice(0, 60);

export async function GET(req: NextRequest) {
  try {
    const ctx = await moduleAccess(EVENTS_SPEC, "view");
    const sp = req.nextUrl.searchParams;
    const kind = sp.get("kind");
    if (kind === "contacts") {
      const q = clean(sp.get("q") ?? "");
      if (q.length < 2) return NextResponse.json({ items: [] });
      const { data } = await ctx.supabase.from("contacts").select("id, name, account_id").eq("tenant_id", ctx.tenantId).ilike("name", `%${q}%`).order("name").limit(15);
      const rows = (data ?? []) as { id: string; name: string; account_id: string }[];
      const ids = [...new Set(rows.map((r) => r.account_id))];
      const accts = ids.length ? await ctx.supabase.from("accounts").select("id, name").eq("tenant_id", ctx.tenantId).in("id", ids) : { data: [] };
      const aName = new Map(((accts.data ?? []) as { id: string; name: string }[]).map((a) => [a.id, a.name]));
      return NextResponse.json({ items: rows.map((r) => ({ id: r.id, name: r.name, company: aName.get(r.account_id) ?? "" })) });
    }
    if (kind === "forms") {
      const { data } = await ctx.supabase.from("forms").select("id, name, status").eq("tenant_id", ctx.tenantId).neq("status", "archived").order("name").limit(200);
      return NextResponse.json({ items: data ?? [] });
    }
    if (kind === "journeys") {
      const { data } = await ctx.supabase.from("journeys").select("id, name, status").eq("tenant_id", ctx.tenantId).neq("status", "archived").order("name").limit(200);
      return NextResponse.json({ items: data ?? [] });
    }
    return NextResponse.json({ error: "Unknown lookup." }, { status: 422 });
  } catch (e) {
    return moduleErrorResponse(EVENTS_SPEC, e);
  }
}
