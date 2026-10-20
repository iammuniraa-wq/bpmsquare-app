import { NextResponse, type NextRequest } from "next/server";
import { isUuid, moduleAccess, moduleErrorResponse, pendingMessage } from "@/lib/marketing/moduleAccess";
import { indexContactNumbers } from "@/lib/marketing/whatsapp/numbers";
import { WHATSAPP_SPEC } from "@/lib/marketing/whatsapp/server";

// POST /api/whatsapp/match-numbers { after? } -- admin only. Hashes the next slice of this workspace's contacts'
// phones so a reply from a number we never messaged can be matched. Call again with `last` until `done`.

export async function POST(req: NextRequest) {
  try {
    const ctx = await moduleAccess(WHATSAPP_SPEC, "edit");
    if (ctx.role !== "admin") return NextResponse.json({ error: "Only an admin can do this." }, { status: 403 });
    const b = (await req.json().catch(() => null)) as { after?: unknown } | null;
    const after = isUuid(b?.after) ? b.after : null;
    const r = await indexContactNumbers(ctx.admin, ctx.tenantId, after);
    if (r.missing) return NextResponse.json({ error: pendingMessage(WHATSAPP_SPEC), pending_migration: true }, { status: 503 });
    return NextResponse.json(r);
  } catch (e) {
    return moduleErrorResponse(WHATSAPP_SPEC, e);
  }
}
