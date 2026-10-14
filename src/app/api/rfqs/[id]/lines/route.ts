import { NextResponse, type NextRequest } from "next/server";
import { rfqAccess, errorResponse, cleanLines, refreshRfqStatus, type NewRfqLine } from "@/lib/rfq/server";
import { logChange } from "@/lib/changeLog";

// Lines of one RFQ.
// PUT   { lines: [...] }                       -- replace all lines (draft only)
// POST  { line: {...} }                        -- add a line to a sent RFQ
//                                                (suppliers see it on the next send)
// PATCH { line_id, action: "cancel" | "reopen" }

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { admin, tenantId, userId, email } = await rfqAccess(true);
    const { id } = await params;
    const { data: rfq } = await admin.from("rfqs").select("id, ref, status").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
    if (!rfq) return NextResponse.json({ error: "RFQ not found" }, { status: 404 });
    if (rfq.status !== "draft") return NextResponse.json({ error: "Lines can only be replaced while the RFQ is a draft — add a line instead." }, { status: 409 });
    const body = (await req.json().catch(() => null)) as { lines?: NewRfqLine[] } | null;
    const lines = await cleanLines(admin, tenantId, body?.lines ?? []);
    const { error: delErr } = await admin.from("rfq_lines").delete().eq("tenant_id", tenantId).eq("rfq_id", id);
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
    const { data, error } = await admin.from("rfq_lines").insert(lines.map((l) => ({ ...l, tenant_id: tenantId, rfq_id: id }))).select("id");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await logChange(admin, { tenantId, objectType: "rfqs", objectId: id, objectLabel: rfq.ref as string, action: "update", actorId: userId, actorEmail: email, changes: [{ field: "lines", from: null, to: lines.length }] });
    return NextResponse.json({ ok: true, line_ids: (data ?? []).map((r) => r.id) });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { admin, tenantId, userId, email } = await rfqAccess(true);
    const { id } = await params;
    const { data: rfq } = await admin.from("rfqs").select("id, ref, status").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
    if (!rfq) return NextResponse.json({ error: "RFQ not found" }, { status: 404 });
    if (["closed", "cancelled", "awarded"].includes(rfq.status as string)) return NextResponse.json({ error: "This RFQ is no longer open." }, { status: 409 });
    const body = (await req.json().catch(() => null)) as { line?: NewRfqLine } | null;
    const [line] = await cleanLines(admin, tenantId, body?.line ? [body.line] : []);
    const { data: last } = await admin.from("rfq_lines").select("sl_no").eq("tenant_id", tenantId).eq("rfq_id", id).order("sl_no", { ascending: false }).limit(1).maybeSingle();
    const { data, error } = await admin.from("rfq_lines").insert({ ...line, sl_no: ((last?.sl_no as number | undefined) ?? 0) + 1, tenant_id: tenantId, rfq_id: id }).select("id").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await logChange(admin, { tenantId, objectType: "rfqs", objectId: id, objectLabel: rfq.ref as string, action: "update", actorId: userId, actorEmail: email, changes: [{ field: "line added", from: null, to: line.description }] });
    return NextResponse.json({ ok: true, line_id: data.id }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { admin, tenantId, userId, email } = await rfqAccess(true);
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as { line_id?: string; action?: string };
    const { data: line } = await admin.from("rfq_lines").select("id, sl_no, status, rfq_id").eq("id", body.line_id ?? "").eq("tenant_id", tenantId).eq("rfq_id", id).maybeSingle();
    if (!line) return NextResponse.json({ error: "Line not found" }, { status: 404 });
    const next = body.action === "cancel" ? "cancelled" : body.action === "reopen" ? "open" : null;
    if (!next) return NextResponse.json({ error: "Unknown action" }, { status: 422 });
    await admin.from("rfq_lines").update({ status: next, ...(next === "open" ? { awarded_response_id: null, awarded_unit_cost: null } : {}), updated_at: new Date().toISOString() }).eq("id", line.id).eq("tenant_id", tenantId);
    const status = await refreshRfqStatus(admin, tenantId, id);
    const { data: rfq } = await admin.from("rfqs").select("ref").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
    await logChange(admin, { tenantId, objectType: "rfqs", objectId: id, objectLabel: (rfq?.ref as string) ?? null, action: "update", actorId: userId, actorEmail: email, changes: [{ field: `line ${line.sl_no}`, from: line.status, to: next }] });
    return NextResponse.json({ ok: true, status });
  } catch (e) {
    return errorResponse(e);
  }
}
