import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "crypto";
import { createAdminSupabase, getAuthUser } from "@/lib/supabase-server";
import { logChange } from "@/lib/changeLog";
import { ORDER_ATTACHMENT_BUCKET, attachmentForScreen, cleanKind, fileExtension, fileProblem, validateAttachmentLink } from "@/lib/salesOrders/attachments";
import { cleanText } from "@/lib/salesOrders/clean";
import { orderLockReason } from "@/lib/salesOrders/lock";
import { failure, guard, loadOrder, needsUpdate, pending } from "@/lib/salesOrders/server";
import { orderAnnotatable } from "@/lib/salesOrders/types";

// Files and links on a sales order (mirrors the Standard Quote attachments, 0119).
//
// GET  /api/sales-orders/[id]/attachments
//   -> [{ id, order_id, kind: "customer_po" | "drawing" | "other", type: "file" | "link", name, ref, href, size_bytes,
//         created_by, created_by_name, created_at }]   `href` opens it (a link's own address, or the download route for a file).
// POST /api/sales-orders/[id]/attachments
//   a file:  multipart/form-data { file, kind?, name? }     (max 15 MB, documents and drawings only)
//   a link:  application/json { type: "link", url, name?, kind? }   (https only, no credentials in the address)
//   -> 201 the same shape. Allowed while orderAnnotatable(): a draft or confirmed order made here.

type Params = { params: Promise<{ id: string }> };

async function creatorNames(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const admin = createAdminSupabase();
  await Promise.all(ids.map(async (id) => {
    try {
      const { data } = await admin.auth.admin.getUserById(id);
      const name = (data.user?.user_metadata?.full_name as string | undefined) ?? data.user?.email ?? null;
      if (name) out.set(id, name);
    } catch { /* a name is a nicety; the row stays listed without it */ }
  }));
  return out;
}

export async function GET(_req: NextRequest, { params }: Params) {
  let ctx;
  try { ctx = await guard(); } catch (e) { return failure(e); }
  const { supabase, tenantId } = ctx;
  const { id } = await params;
  const loaded = await loadOrder(supabase, tenantId, id);
  if (loaded.kind === "pending") return needsUpdate();
  if (loaded.kind === "missing") return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (loaded.kind === "error") return NextResponse.json({ error: loaded.message }, { status: 500 });

  const { data, error } = await supabase.from("sales_order_attachments").select("*").eq("order_id", id).eq("tenant_id", tenantId).order("created_at", { ascending: false });
  if (error) return pending(error) ? NextResponse.json([]) : NextResponse.json({ error: error.message }, { status: 500 });
  const rows = (data ?? []) as Parameters<typeof attachmentForScreen>[1][];
  const names = await creatorNames([...new Set(rows.map((r) => r.created_by).filter((x): x is string => !!x))]);
  return NextResponse.json(rows.map((r) => ({ ...attachmentForScreen(id, r), created_by_name: r.created_by ? names.get(r.created_by) ?? null : null })));
}

export async function POST(req: NextRequest, { params }: Params) {
  let ctx;
  try { ctx = await guard(); } catch (e) { return failure(e); }
  const { supabase, tenantId, userId } = ctx;
  const { id } = await params;
  const loaded = await loadOrder(supabase, tenantId, id);
  if (loaded.kind === "pending") return needsUpdate();
  if (loaded.kind === "missing") return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (loaded.kind === "error") return NextResponse.json({ error: loaded.message }, { status: 500 });
  const { order, erpLinked } = loaded.value;
  if (!orderAnnotatable(order)) {
    const reason = orderLockReason(order, erpLinked);
    return NextResponse.json({ error: reason, lock_reason: reason }, { status: 409 });
  }

  const contentType = req.headers.get("content-type") ?? "";
  let row: Record<string, unknown>;
  let label: string;

  if (contentType.includes("application/json")) {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || body.type !== "link") return NextResponse.json({ error: "Send a file as multipart form data, or { type: \"link\", url }" }, { status: 400 });
    const link = validateAttachmentLink(body.url);
    if (!link.ok) return NextResponse.json({ error: link.error }, { status: 400 });
    const name = cleanText(body.name, 200) ?? link.host;
    row = { tenant_id: tenantId, order_id: id, kind: cleanKind(body.kind), type: "link", name, ref: link.url, mime_type: null, size_bytes: null, created_by: userId };
    label = `${name} (link)`;
  } else {
    const form = await req.formData().catch(() => null);
    const file = form?.get("file") as File | null;
    if (!file || typeof file === "string") return NextResponse.json({ error: "No file provided" }, { status: 400 });
    const problem = fileProblem(file);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });
    const ext = fileExtension(file.name);
    const path = `${tenantId}/${id}/${randomUUID()}.${ext}`;
    const admin = createAdminSupabase();
    const { error: upErr } = await admin.storage.from(ORDER_ATTACHMENT_BUCKET).upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type || undefined, upsert: false });
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
    const name = cleanText(form?.get("name"), 200) ?? file.name.slice(0, 200);
    row = { tenant_id: tenantId, order_id: id, kind: cleanKind(form?.get("kind")), type: "file", name, ref: path, mime_type: file.type || null, size_bytes: file.size, created_by: userId };
    label = name;
  }

  const { data, error } = await supabase.from("sales_order_attachments").insert(row).select("*").single();
  if (error || !data) {
    if (row.type === "file") await createAdminSupabase().storage.from(ORDER_ATTACHMENT_BUCKET).remove([row.ref as string]).catch(() => {});
    return pending(error) ? needsUpdate() : NextResponse.json({ error: error?.message ?? "Could not save the attachment" }, { status: 500 });
  }

  const user = await getAuthUser();
  await logChange(supabase, {
    tenantId, objectType: "sales_orders", objectId: id, objectLabel: order.ref,
    action: "update", actorId: user?.id, actorEmail: user?.email,
    changes: [{ field: row.type === "link" ? "Link added" : "File added", from: null, to: label }],
  });
  return NextResponse.json(attachmentForScreen(id, data as Parameters<typeof attachmentForScreen>[1]), { status: 201 });
}
