import { NextResponse, type NextRequest } from "next/server";
import { openBoqRequest, priceAllLines, priceOneLine } from "@/lib/tender/boq/server";
import { PRICE_SOURCES, type PriceSource } from "@/lib/tender/boq/price";

// POST /api/opportunities/[id]/boq/price
//   { all: true, markup_pct }                                       price the lines that have no rate, from FRESH sources only
//   { line, source, ref, markup_pct?, accept_stale? }               apply one offered price (the server looks the price up again)
//   { line, source: "manual", rate }                                a rate typed by hand
// The price never comes from the body except for a manual rate: source and ref only NAME an offer the server finds for itself.

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await openBoqRequest(id, true);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  if (body.all === true) {
    const out = await priceAllLines(gate.req, body.markup_pct);
    if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status });
    return NextResponse.json(out);
  }
  const line = typeof body.line === "string" ? body.line : "";
  if (!/^[0-9a-f-]{36}$/i.test(line)) return NextResponse.json({ error: "Line not found" }, { status: 404 });
  const source = body.source as PriceSource;
  if (!PRICE_SOURCES.includes(source)) return NextResponse.json({ error: "Unknown price source" }, { status: 400 });
  const out = await priceOneLine(gate.req, line, {
    source, ref: typeof body.ref === "string" ? body.ref : null,
    markup_pct: typeof body.markup_pct === "number" ? body.markup_pct : null,
    accept_stale: body.accept_stale === true, rate: typeof body.rate === "number" ? body.rate : null,
  });
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json(out);
}
