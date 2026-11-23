import { NextResponse, type NextRequest } from "next/server";
import { openAllocation } from "@/lib/contractProjects/allocationServer";
import { UUID_RE } from "@/lib/contractProjects/server";
import { setLineElement } from "@/lib/elements/projectServer";
import { failed, readBody, NOT_FOUND } from "@/lib/elements/respond";
import { buildingsOn } from "@/lib/elements/server";

// PATCH /api/contract-projects/[id]/elements/[lineKey]  { element_type?, element_code?, model_qty?, accept_model?, use_client? }
//   One budget line's element fields. Only on a DRAFT revision: an approved budget answers 409 `locked` ("start a revision"). The type must be in the
//   workspace's Element types list; a typed code is upper-cased, checked for characters and length, and must be unique on the project (409). A cost-only
//   category line takes no code, a line split across buildings cannot carry one, and a type cannot change under an issued code (clear the code first).
//   `accept_model` puts the model quantity in the budget quantity (re-pricing the line's own cost; the contract side never moves); `use_client`
//   puts the client quantity back. `lineKey` is the stable key of a line of THIS project's current revision; any other is a 404.

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; lineKey: string }> }) {
  const { id, lineKey } = await params;
  if (!UUID_RE.test(lineKey)) return NextResponse.json({ error: "Line not found" }, { status: 404 });
  const open = await openAllocation(id, true);
  if (!open.ok) return failed(open);
  if (!(await buildingsOn(open.req.supabase, open.req.tenantId))) return NOT_FOUND();
  const body = await readBody(request);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const out = await setLineElement(open, lineKey, body);
  if (!out.ok) return failed(out);
  return NextResponse.json({ ok: true });
}
