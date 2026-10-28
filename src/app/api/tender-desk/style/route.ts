import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";
import { isTenderDeskStyle, TENDER_DESK_COOKIE } from "@/lib/tenderDesk/style";

// POST { style: "bold" | "control" }: remembers the person's own choice of Tender desk look in the cookie `bpm_tender_desk`, so the
// server renders the right one on the first paint (docs/design/tender-desk.md). Nothing is stored in the database: this is a per-browser
// preference, and the workspace default lives in Settings > Appearance. The cookie is httpOnly because only the server reads it.
export async function POST(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireTenantUser();
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    return NextResponse.json({ error: err.message ?? "Unauthorized" }, { status: err.status ?? 401 });
  }
  if (!(await tenantHasFeature(ctx.supabase, ctx.tenantId, "gcc_tender"))) return NextResponse.json({ error: "Not found" }, { status: 403 });

  const body = (await request.json().catch(() => null)) as { style?: unknown } | null;
  if (!isTenderDeskStyle(body?.style)) return NextResponse.json({ error: "style must be bold or control" }, { status: 400 });

  const res = NextResponse.json({ ok: true });
  res.cookies.set(TENDER_DESK_COOKIE, body.style, {
    path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", httpOnly: true, secure: process.env.NODE_ENV === "production",
  });
  return res;
}
