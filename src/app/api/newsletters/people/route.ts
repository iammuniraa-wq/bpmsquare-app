import { NextResponse, type NextRequest } from "next/server";
import { errorResponse, newsletterAccess } from "@/lib/newsletter/server";

// GET /api/newsletters/people?q= -> up to six contacts and six accounts of THIS workspace whose name
// matches, for the "See it as this person" picker. Names only: no email, no phone.
export async function GET(req: NextRequest) {
  try {
    const ctx = await newsletterAccess("view");
    const q = (req.nextUrl.searchParams.get("q") ?? "").replace(/[^\p{L}\p{N} _.-]/gu, "").trim().slice(0, 60);
    if (q.length < 2) return NextResponse.json({ people: [] });
    const [contacts, accounts] = await Promise.all([
      ctx.supabase.from("contacts").select("id, name, account_id").eq("tenant_id", ctx.tenantId).ilike("name", `%${q}%`).limit(6),
      ctx.supabase.from("accounts").select("id, name").eq("tenant_id", ctx.tenantId).ilike("name", `%${q}%`).limit(6),
    ]);
    const accountNames = new Map<string, string>();
    const ids = [...new Set(((contacts.data ?? []) as { account_id: string }[]).map((c) => c.account_id))];
    if (ids.length) {
      const r = await ctx.supabase.from("accounts").select("id, name").eq("tenant_id", ctx.tenantId).in("id", ids);
      for (const a of (r.data ?? []) as { id: string; name: string }[]) accountNames.set(a.id, a.name);
    }
    return NextResponse.json({
      people: [
        ...((contacts.data ?? []) as { id: string; name: string; account_id: string }[]).map((c) => ({ kind: "contact" as const, id: c.id, name: c.name, account_name: accountNames.get(c.account_id) ?? null })),
        ...((accounts.data ?? []) as { id: string; name: string }[]).map((a) => ({ kind: "account" as const, id: a.id, name: a.name, account_name: null })),
      ],
    });
  } catch (e) {
    return errorResponse(e);
  }
}
