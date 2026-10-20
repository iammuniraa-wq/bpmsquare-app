import { NextResponse, type NextRequest } from "next/server";
import { abmAccess, errorResponse, isUuid } from "@/lib/abm/server";
import { userNames } from "@/lib/abm/views";

// Small pickers for the ABM screens. Names and ids only: no phone, email or any other personal field.
//
// GET /api/abm/lookup?kind=accounts&q=      accounts of this workspace by name
//     kind=groups                           marketing target groups
//     kind=segments                         Coverage segments
//     kind=users                            colleagues (for owners)
//     kind=contacts&account_id=             people at one account
//     kind=deals&account_id=                deals of one account

const clean = (s: string) => s.replace(/[,()%*\\]/g, " ").trim().slice(0, 60);

export async function GET(req: NextRequest) {
  try {
    const ctx = await abmAccess("view");
    const sp = req.nextUrl.searchParams;
    const kind = sp.get("kind");

    if (kind === "accounts") {
      const q = clean(sp.get("q") ?? "");
      let query = ctx.supabase.from("accounts").select("id, name, city").eq("tenant_id", ctx.tenantId).order("name").limit(20);
      if (q) query = query.ilike("name", `%${q}%`);
      const { data } = await query;
      return NextResponse.json({ items: data ?? [] });
    }
    if (kind === "groups") {
      const { data } = await ctx.supabase.from("marketing_target_groups").select("id, name").eq("tenant_id", ctx.tenantId).order("name").limit(200);
      return NextResponse.json({ items: data ?? [] });
    }
    if (kind === "segments") {
      const { data } = await ctx.supabase.from("segments").select("id, name").eq("tenant_id", ctx.tenantId).order("name").limit(200);
      return NextResponse.json({ items: data ?? [] });
    }
    if (kind === "users") {
      const names = await userNames(ctx);
      return NextResponse.json({ items: [...names.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)) });
    }
    const accountId = sp.get("account_id");
    if (kind === "contacts" && isUuid(accountId)) {
      const { data } = await ctx.supabase.from("contacts").select("id, name, role").eq("tenant_id", ctx.tenantId).eq("account_id", accountId).order("name").limit(200);
      return NextResponse.json({ items: data ?? [] });
    }
    if (kind === "deals" && isUuid(accountId)) {
      const { data } = await ctx.supabase.from("opportunities").select("id, ref, title, outcome").eq("tenant_id", ctx.tenantId).eq("account_id", accountId).order("created_at", { ascending: false }).limit(50);
      return NextResponse.json({ items: data ?? [] });
    }
    return NextResponse.json({ error: "Unknown lookup." }, { status: 422 });
  } catch (e) {
    return errorResponse(e);
  }
}
