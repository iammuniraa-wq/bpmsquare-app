import { NextResponse, type NextRequest } from "next/server";
import { guard, jsonBody } from "../../../_guard";
import { get, remove, update } from "@/lib/connections/ops";
import type { ConnectionInput } from "@/lib/connections/spec";

// One connection of this workspace. A foreign or unknown id is 404 (the query carries the tenant).
//   GET -> { connection }   PUT (same body as POST, a blank secret = unchanged) -> { connection }   DELETE -> { ok: true }
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard();
  if (!g.ok) return g.res;
  const o = await get(g.ctx, (await params).id);
  return NextResponse.json(o.body, { status: o.status });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard();
  if (!g.ok) return g.res;
  const o = await update(g.ctx, (await params).id, await jsonBody<ConnectionInput>(req));
  return NextResponse.json(o.body, { status: o.status });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard();
  if (!g.ok) return g.res;
  const o = await remove(g.ctx, (await params).id);
  return NextResponse.json(o.body, { status: o.status });
}
