import { NextResponse, type NextRequest } from "next/server";
import { createReceipt, listReceipts } from "@/lib/site/receiptsServer";
import { failure, needsUpdate, openSiteRequest } from "@/lib/site/server";

// GET  /api/site-receipts[?project_id=]  -> { rows } the confirmed and cancelled receipts of the workspace's site projects, newest first.
// POST /api/site-receipts  multipart { payload: JSON, photos[], signature? } or JSON  -> 201 { receipt } (200 + duplicate_request when the same
//      client_id was sent before). The outcome is computed from the lines; a reason is required for every short, over, rejected or damaged item.
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const gate = await openSiteRequest("site_receipts");
  if (!gate.ok) return failure(gate);
  const { rows, pending } = await listReceipts(gate.req, { projectId: request.nextUrl.searchParams.get("project_id") });
  if (pending) return failure(needsUpdate("site_receipts"));
  return NextResponse.json({ rows });
}

export async function POST(request: NextRequest) {
  const gate = await openSiteRequest("site_receipts");
  if (!gate.ok) return failure(gate);
  const r = await createReceipt(gate.req, request);
  return NextResponse.json(r.body, { status: r.status });
}
