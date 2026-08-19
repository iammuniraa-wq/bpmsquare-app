import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase, getAuthUser } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";

/**
 * Nova pillar 3 — record comments. GET returns a record's comments plus the
 * mentionable members (workspace colleagues' emails — needed for the @
 * autocomplete; fine to share inside a workspace, and PII-free otherwise).
 * POST appends a comment; comments are append-only by RLS design (0089).
 *
 * The record's existence in THIS tenant is verified before either
 * direction -- object_id comes from the client, and the guardrails treat
 * every client-supplied foreign id as unproven until checked.
 */

// object_type → its table, mirroring changeLog's vocabulary. Timeline ships
// on quotations first; the map is the extension point.
const OBJECTS: Record<string, string> = {
  quotes: "quotes",
  accounts: "accounts",
  contacts: "contacts",
};

async function verifyRecord(tenantId: string, objectType: string, objectId: string): Promise<boolean> {
  const table = OBJECTS[objectType];
  if (!table) return false;
  const { data } = await createAdminSupabase()
    .from(table).select("id").eq("id", objectId).eq("tenant_id", tenantId).maybeSingle();
  return !!data;
}

export async function GET(request: NextRequest) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (!(await tenantHasFeature(supabase, tenantId, "next_experience"))) {
    return NextResponse.json({ error: "Nova isn't enabled for your workspace" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const objectType = searchParams.get("object_type") ?? "";
  const objectId = searchParams.get("object_id") ?? "";
  if (!OBJECTS[objectType] || !objectId) {
    return NextResponse.json({ error: "object_type and object_id are required" }, { status: 400 });
  }
  if (!(await verifyRecord(tenantId, objectType, objectId))) {
    return NextResponse.json({ error: "Record not found" }, { status: 404 });
  }

  const admin = createAdminSupabase();
  const [{ data: comments, error }, { data: members }] = await Promise.all([
    admin.from("record_comments")
      .select("id, author_email, body, mentions, created_at")
      .eq("tenant_id", tenantId).eq("object_type", objectType).eq("object_id", objectId)
      .order("created_at", { ascending: false })
      .limit(100),
    admin.from("tenant_users").select("user_id").eq("tenant_id", tenantId).limit(100),
  ]);
  if (error) {
    // Table not migrated yet (0089) -- the timeline degrades to change
    // history only; the composer will explain on first post.
    return NextResponse.json({ comments: [], mentionables: [] });
  }

  const ids = new Set((members ?? []).map((m) => m.user_id as string));
  const mentionables: string[] = [];
  let page = 1;
  while (ids.size > 0 && mentionables.length < ids.size && page <= 3) {
    const { data: authPage, error: listErr } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (listErr || !authPage) break;
    for (const u of authPage.users) if (u.email && ids.has(u.id)) mentionables.push(u.email);
    if (authPage.users.length < 1000) break;
    page++;
  }

  return NextResponse.json({ comments: comments ?? [], mentionables: mentionables.sort() });
}

export async function POST(request: NextRequest) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (!(await tenantHasFeature(supabase, tenantId, "next_experience"))) {
    return NextResponse.json({ error: "Nova isn't enabled for your workspace" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const objectType = typeof body?.object_type === "string" ? body.object_type : "";
  const objectId = typeof body?.object_id === "string" ? body.object_id : "";
  const text = typeof body?.body === "string" ? body.body.trim().slice(0, 2000) : "";
  if (!OBJECTS[objectType] || !objectId) {
    return NextResponse.json({ error: "object_type and object_id are required" }, { status: 400 });
  }
  if (!text) return NextResponse.json({ error: "Write something first" }, { status: 400 });
  if (!(await verifyRecord(tenantId, objectType, objectId))) {
    return NextResponse.json({ error: "Record not found" }, { status: 404 });
  }

  // Mentions: only @tokens that are REAL member emails are stored -- the
  // inbox must never fan out to an arbitrary typed string.
  const requested = new Set<string>(
    (text.match(/@[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g) ?? []).map((m: string) => m.slice(1).toLowerCase())
  );
  let mentions: string[] = [];
  if (requested.size > 0) {
    const admin = createAdminSupabase();
    const { data: members } = await admin.from("tenant_users").select("user_id").eq("tenant_id", tenantId).limit(100);
    const ids = new Set((members ?? []).map((m) => m.user_id as string));
    const { data: authPage } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const memberEmails = new Set(
      (authPage?.users ?? []).filter((u) => u.email && ids.has(u.id)).map((u) => u.email!.toLowerCase())
    );
    mentions = [...requested].filter((r) => memberEmails.has(r));
  }

  const user = await getAuthUser();
  const { data, error } = await supabase.from("record_comments").insert({
    tenant_id: tenantId,
    object_type: objectType,
    object_id: objectId,
    author_id: user?.id ?? null,
    author_email: user?.email ?? null,
    body: text,
    mentions,
  }).select("id, author_email, body, mentions, created_at").single();

  if (error) {
    return NextResponse.json(
      { error: "Could not save the comment — has migration 0089 been applied?" },
      { status: 500 }
    );
  }
  return NextResponse.json(data, { status: 201 });
}
