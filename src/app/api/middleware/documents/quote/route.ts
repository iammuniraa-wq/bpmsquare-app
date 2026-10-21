import { NextResponse, type NextRequest } from "next/server";
import { guard, jsonBody, fail } from "../../_guard";
import { saveDocument } from "@/lib/middleware/ops";
import { logChange } from "@/lib/changeLog";
import { getAuthUser } from "@/lib/supabase-server";

// PUT { enabled?, target?, include?: { <key>: boolean }, fallbackPriceListId?: <guid>|null }
//   -> the document, as GET /api/middleware/documents returns it.
// 422 { error, errors: [{ field, message }] } for an unknown setting, a target the connected system cannot create, or an
// item the chosen target cannot carry. The first successful save confirms the document (`confirmed`).
export async function PUT(req: NextRequest) {
  const g = await guard();
  if (!g.ok) return g.res;
  const r = await saveDocument(g.ctx.admin, g.ctx.tenantId, await jsonBody(req));
  if (!r.ok) return fail(422, r.errors[0].message, { errors: r.errors });
  const u = await getAuthUser();
  await logChange(g.ctx.supabase, {
    tenantId: g.ctx.tenantId, objectType: "tenants", objectId: g.ctx.tenantId, objectLabel: "Integration middleware: Quote link", action: "update",
    actorId: u?.id, actorEmail: u?.email, changes: [{ field: "quote link", from: null, to: r.document.summary }],
  });
  return NextResponse.json(r.document);
}
