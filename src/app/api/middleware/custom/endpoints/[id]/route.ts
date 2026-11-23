import { NextResponse, type NextRequest } from "next/server";
import { guard, jsonBody } from "../../../_guard";
import { removeEndpoint, updateEndpoint } from "@/lib/connections/endpointOps";

// PUT any of the endpoint's fields (a request that only sends { enabled } is valid) -> { endpoint }. DELETE -> { ok: true }.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard();
  if (!g.ok) return g.res;
  const o = await updateEndpoint(g.ctx, (await params).id, await jsonBody(req));
  return NextResponse.json(o.body, { status: o.status });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard();
  if (!g.ok) return g.res;
  const o = await removeEndpoint(g.ctx, (await params).id);
  return NextResponse.json(o.body, { status: o.status });
}
