import { NextResponse, type NextRequest } from "next/server";
import { estimatorAccess, errorResponse } from "@/lib/estimator/server";
import { inboxAccess } from "@/lib/inbox/server";
import { measureAttachment } from "@/lib/estimator/drawing/run";

// POST { email_id, attachment_id, unit_factor? } -- measure one DXF attachment of an inbox message.
//   -> { file, unit, warnings, extents, layers (the table of layers with lengths, areas and block counts), counts, model, modelNote }
// `model` is the drawing for the viewer (thinned if it is large; null when too large to send). Nothing is saved.
// `unit_factor` = metres per drawing unit, for a drawing that does not state its units or states them wrongly.
// Needs estimate-create access (it is how a new estimate is started from an email) and the Inbox; the attachment must be on a
// message in a channel the person may see, in the session's own workspace. Anything else is a 404.
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    await estimatorAccess("create");
    const ctx = await inboxAccess(false);
    const body = (await req.json().catch(() => null)) as { email_id?: unknown; attachment_id?: unknown; unit_factor?: unknown } | null;
    const f = body?.unit_factor;
    if (f !== undefined && f !== null && !(typeof f === "number" && Number.isFinite(f) && f > 0)) {
      return NextResponse.json({ error: "The unit must be a number above zero (metres per drawing unit)." }, { status: 422 });
    }
    const r = await measureAttachment(ctx, { emailId: body?.email_id, attachmentId: body?.attachment_id, ...(typeof f === "number" ? { factor: f } : {}) });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json(r.payload, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
