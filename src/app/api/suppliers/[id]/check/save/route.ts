import { NextResponse, type NextRequest } from "next/server";
import { actionsEnabled } from "@/lib/actions/registry";
import { runVia } from "@/lib/actions/via";
import { isUuid } from "@/lib/assistant/objects";
import { isSession, logCheckSaved, resolveCheckSession } from "@/lib/suppliers/check/access";
import { checkGate, persistCheck } from "@/lib/suppliers/check/service";
import { verifySaveToken } from "@/lib/suppliers/check/token";
import type { SupplierCheckResult } from "@/lib/suppliers/check/types";

// POST /api/suppliers/[id]/check/save { result, token } -- the press of "Save to supplier" on the assistant's card. It is the only
// write the assistant makes for a supplier check, so it needs the assistant's actions switched on AND the person's own right to edit
// suppliers. The result is saved only when the signed token proves this server computed exactly this result for this person, this
// workspace and this supplier: a client cannot save text it wrote itself, and a result cannot be saved for another supplier.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await resolveCheckSession();
  if (!isSession(s)) return s;
  const { id } = await params;
  const gate = checkGate(s, "run");
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!actionsEnabled(s.features)) return NextResponse.json({ error: "The assistant cannot make changes in this workspace." }, { status: 403 });

  const body = (await request.json().catch(() => null)) as { result?: unknown; token?: unknown } | null;
  const result = body?.result as SupplierCheckResult | undefined;
  if (!result || typeof result !== "object" || result.supplierId !== id) return NextResponse.json({ error: "Nothing to save." }, { status: 400 });
  const v = verifySaveToken(body?.token, { tenantId: s.tenantId, userId: s.userId, result });
  if (!v.ok) return NextResponse.json({ error: "This check can no longer be saved. Run it again.", code: v.reason }, { status: 403 });

  const saved = await persistCheck(s, result);
  if (!saved.ok) return NextResponse.json({ error: saved.error, pending: saved.pending }, { status: saved.pending ? 503 : 404 });
  await runVia("assistant", () => logCheckSaved(s, result));
  return NextResponse.json({ saved: true, id: saved.id });
}
