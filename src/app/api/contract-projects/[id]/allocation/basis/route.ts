import { NextResponse, type NextRequest } from "next/server";
import { changeBasis, openAllocation } from "@/lib/contractProjects/allocationServer";
import { ALLOCATION_BASES, type AllocationBasis } from "@/lib/contractProjects/types";

// PATCH /api/contract-projects/[id]/allocation/basis  { basis: "line" | "package" }
//      Allocate by BOQ line or by work package. Allowed until a baseline is waiting for approval or approved (409 `locked` after). Switching
//      clears every typed cost and every package cost; the package grouping is kept. 200 { basis, total }.

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const open = await openAllocation(id, true);
  if (!open.ok) return NextResponse.json({ error: open.error, ...(open.extra ?? {}) }, { status: open.status });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const basis = body?.basis;
  if (typeof basis !== "string" || !(ALLOCATION_BASES as readonly string[]).includes(basis)) return NextResponse.json({ error: "basis is line or package" }, { status: 400 });
  const done = await changeBasis(open, basis as AllocationBasis);
  if (!done.ok) return NextResponse.json({ error: done.error, ...(done.extra ?? {}) }, { status: done.status });
  return NextResponse.json({ basis: done.basis, total: done.total });
}
