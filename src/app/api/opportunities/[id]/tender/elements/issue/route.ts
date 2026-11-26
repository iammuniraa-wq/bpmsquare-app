import { NextResponse, type NextRequest } from "next/server";
import { openBoqRequest } from "@/lib/tender/boq/server";
import { issueCodes, tenderEnabled } from "@/lib/elements/tenderServer";
import { failed, readBody } from "@/lib/elements/respond";

// POST /api/opportunities/[id]/tender/elements/issue  { keys?: string[], preview?: boolean }
//   "Issue codes" on a tender (optional): every BOQ line (or the ticked ones) with a building and an element type but no code gets its next code from
//   the workspace pattern. Idempotent; numbers are never reused; `preview: true` writes nothing. -> { plan, written, pattern }

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await openBoqRequest(id, true);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  if (!(await tenderEnabled(gate.req))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = (await readBody(request)) ?? {};
  const out = await issueCodes(gate.req, { keys: body.keys, preview: body.preview });
  if (!out.ok) return failed(out);
  return NextResponse.json({ plan: out.plan, written: out.written, pattern: out.pattern });
}
