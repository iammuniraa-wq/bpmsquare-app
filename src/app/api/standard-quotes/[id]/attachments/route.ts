import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "crypto";
import { requireTenantUser, createAdminSupabase, getAuthUser } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";
import { logChange } from "@/lib/changeLog";

// Standard Quote attachments (0119, docs/sales-engine-architecture.md
// §3.7): customer communication stored privately against the quote. The
// bucket is private; every read goes through a short-lived signed URL
// (the [attId] route), never a public URL. Mirrors api/cases/[id]/photos.

const MAX_BYTES = 15 * 1024 * 1024;
// Correspondence and documents only -- no SVG (stored XSS via a public
// URL is moot in a private bucket, but there is no reason to accept it),
// no executables.
const ALLOWED_EXT = ["pdf", "png", "jpg", "jpeg", "webp", "heic", "xlsx", "xlsm", "csv", "tsv", "txt", "doc", "docx", "eml", "msg", "ppt", "pptx"];

async function guard() {
  const { supabase, tenantId, userId } = await requireTenantUser();
  if (!(await tenantHasFeature(supabase, tenantId, "standard_quotes"))) {
    throw Object.assign(new Error("Standard Quotes isn't enabled for your workspace"), { status: 403 });
  }
  return { supabase, tenantId, userId };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let tenantId;
  try { ({ tenantId } = await guard()); } catch (e: unknown) {
    const err = e as { status?: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status ?? 401 });
  }
  const { id } = await params;
  const admin = createAdminSupabase();
  const { data, error } = await admin.from("standard_quote_attachments")
    .select("id, file_name, mime_type, size_bytes, note, uploaded_by, created_at")
    .eq("standard_quote_id", id).eq("tenant_id", tenantId).order("created_at", { ascending: false });
  // 42P01: 0119 pending -- an empty list, never a crash.
  if (error) return NextResponse.json([]);
  return NextResponse.json(data ?? []);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId, userId;
  try { ({ supabase, tenantId, userId } = await guard()); } catch (e: unknown) {
    const err = e as { status?: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status ?? 401 });
  }
  const { id } = await params;
  const form = await request.formData();
  const file = form.get("file") as File | null;
  const note = ((form.get("note") as string) || "").trim().slice(0, 500);
  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "File too large (max 15 MB)" }, { status: 400 });
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  if (!ALLOWED_EXT.includes(ext)) {
    return NextResponse.json({ error: `That file type isn't accepted. Allowed: ${ALLOWED_EXT.join(", ")}` }, { status: 400 });
  }

  const admin = createAdminSupabase();
  const { data: quote } = await admin.from("standard_quotes").select("id, ref").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!quote) return NextResponse.json({ error: "Quote not found" }, { status: 404 });

  const path = `${tenantId}/${id}/${randomUUID()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const { error: upErr } = await admin.storage.from("quote-attachments").upload(path, buffer, { contentType: file.type || undefined, upsert: false });
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  const { data: row, error: dbErr } = await admin.from("standard_quote_attachments").insert({
    tenant_id: tenantId, standard_quote_id: id, file_name: file.name.slice(0, 200), storage_path: path,
    mime_type: file.type || null, size_bytes: file.size, note: note || null, uploaded_by: userId,
  }).select("id, file_name, mime_type, size_bytes, note, uploaded_by, created_at").single();
  if (dbErr) {
    await admin.storage.from("quote-attachments").remove([path]).catch(() => {});
    return NextResponse.json({ error: dbErr.message }, { status: 500 });
  }

  const user = await getAuthUser();
  await logChange(supabase, {
    tenantId, objectType: "standard_quotes", objectId: id, objectLabel: quote.ref,
    action: "update", actorId: user?.id, actorEmail: user?.email,
    changes: [{ field: "Attachment added", from: null, to: `${file.name}${note ? ` — ${note}` : ""}` }],
  });
  return NextResponse.json(row, { status: 201 });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId;
  try { ({ supabase, tenantId } = await guard()); } catch (e: unknown) {
    const err = e as { status?: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status ?? 401 });
  }
  const { id } = await params;
  const { attachment_id } = await request.json().catch(() => ({}));
  if (typeof attachment_id !== "string" || !attachment_id) return NextResponse.json({ error: "attachment_id is required" }, { status: 400 });

  const admin = createAdminSupabase();
  const { data: att } = await admin.from("standard_quote_attachments")
    .select("id, file_name, storage_path").eq("id", attachment_id).eq("standard_quote_id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!att) return NextResponse.json({ error: "Attachment not found" }, { status: 404 });

  await admin.storage.from("quote-attachments").remove([att.storage_path]).catch(() => {});
  await admin.from("standard_quote_attachments").delete().eq("id", att.id).eq("tenant_id", tenantId);

  const { data: quote } = await admin.from("standard_quotes").select("ref").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  const user = await getAuthUser();
  await logChange(supabase, {
    tenantId, objectType: "standard_quotes", objectId: id, objectLabel: quote?.ref ?? null,
    action: "update", actorId: user?.id, actorEmail: user?.email,
    changes: [{ field: "Attachment removed", from: att.file_name, to: null }],
  });
  return NextResponse.json({ ok: true });
}
