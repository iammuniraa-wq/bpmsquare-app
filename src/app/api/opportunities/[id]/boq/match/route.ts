import { NextResponse, type NextRequest } from "next/server";
import { openBoqRequest } from "@/lib/tender/boq/server";
import { buildMatchState, linkProducts, searchProducts } from "@/lib/tender/boq/matchServer";

// GET  /api/opportunities/[id]/boq/match            the BOQ lines that have no catalog product, each with up to three ranked suggestions
//                                                    (name, SKU, unit, score and band -- never a cost), and the lines fingerprint.
// GET  /api/opportunities/[id]/boq/match?q=pipe     a product search for the "pick another" box: name, SKU and unit of ten products at most.
// POST /api/opportunities/[id]/boq/match            { base_version, links: [{ line, product_id }] } or { base_version, accept_strong: true }.
//      Sets product_id on deal lines only. 409 lines_changed when the lines moved since the list was loaded; 404 for a product that
//      is not this workspace's; a weak match is never linked by accept_strong.

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await openBoqRequest(id, false);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const q = new URL(request.url).searchParams.get("q");
  if (q !== null) return NextResponse.json({ products: await searchProducts(gate.req, q) });
  return NextResponse.json(await buildMatchState(gate.req));
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await openBoqRequest(id, true);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  const out = await linkProducts(gate.req, body);
  if (!out.ok) return NextResponse.json({ error: out.error, ...(out.code ? { code: out.code } : {}) }, { status: out.status });
  return NextResponse.json(out);
}
