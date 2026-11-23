import { NextResponse, type NextRequest } from "next/server";
import { openAllocation } from "@/lib/contractProjects/allocationServer";
import { issueCodes } from "@/lib/elements/projectServer";
import { failed, readBody, NOT_FOUND } from "@/lib/elements/respond";
import { buildingsOn } from "@/lib/elements/server";

// POST /api/contract-projects/[id]/elements/issue  { keys?: string[], preview?: boolean }
//   "Issue codes": every line (or the ticked ones) that has a building and an element type but no code gets its next code from the pattern. Idempotent:
//   a line with a code is skipped, and numbers are never reused. `preview: true` answers what would be issued and writes nothing. Draft revisions only
//   (409 `locked` otherwise). The project freezes its pattern when its first code is issued.
//   -> { plan: { assignments, skipped, groups, summary }, written, pattern }

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const open = await openAllocation(id, true);
  if (!open.ok) return failed(open);
  if (!(await buildingsOn(open.req.supabase, open.req.tenantId))) return NOT_FOUND();
  const body = (await readBody(request)) ?? {};
  const out = await issueCodes(open, { keys: body.keys, preview: body.preview });
  if (!out.ok) return failed(out);
  return NextResponse.json({ plan: out.plan, written: out.written, pattern: out.pattern });
}
