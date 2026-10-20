import { NextResponse, type NextRequest } from "next/server";
import { errorResponse, journeyAccess } from "@/lib/marketing/journeys/access";
import { isSchemaPending } from "@/lib/marketing/pending";

// The two pickers the builder needs.
//
// GET /api/journeys/lookup?kind=versions            -> kept newsletter versions: { id, label, languages }
// GET /api/journeys/lookup?kind=contacts&q=abc      -> up to 15 people by name: { id, name, account }

export async function GET(req: NextRequest) {
  try {
    const ctx = await journeyAccess("view");
    const kind = req.nextUrl.searchParams.get("kind");
    if (kind === "versions") {
      const { data, error } = await ctx.admin.from("newsletter_versions").select("id, version, snapshot, newsletter_id, created_at").eq("tenant_id", ctx.tenantId).order("created_at", { ascending: false }).limit(60);
      if (error) return NextResponse.json({ versions: [], ...(isSchemaPending(error) ? { pending_migration: true } : {}) });
      const rows = (data ?? []) as { id: string; version: number; snapshot: { name?: string; languages?: { lang: string; status?: string }[] } }[];
      return NextResponse.json({ versions: rows.map((r) => ({ id: r.id, label: `${r.snapshot?.name ?? "Newsletter"} · version ${r.version}`, languages: (r.snapshot?.languages ?? []).map((l) => l.lang) })) });
    }
    if (kind === "contacts") {
      const q = (req.nextUrl.searchParams.get("q") ?? "").replace(/[%,()*\\]/g, " ").trim().slice(0, 60);
      if (q.length < 2) return NextResponse.json({ contacts: [] });
      const { data } = await ctx.admin.from("contacts").select("id, name, account_id").eq("tenant_id", ctx.tenantId).ilike("name", `%${q}%`).limit(15);
      const rows = (data ?? []) as { id: string; name: string; account_id: string }[];
      const accounts = rows.length ? await ctx.admin.from("accounts").select("id, name").eq("tenant_id", ctx.tenantId).in("id", [...new Set(rows.map((r) => r.account_id))]) : { data: [] };
      const nameOf = new Map(((accounts.data ?? []) as { id: string; name: string }[]).map((a) => [a.id, a.name]));
      return NextResponse.json({ contacts: rows.map((r) => ({ id: r.id, name: r.name, account: nameOf.get(r.account_id) ?? "" })) });
    }
    return NextResponse.json({ error: "Unknown lookup." }, { status: 422 });
  } catch (e) {
    return errorResponse(e);
  }
}
