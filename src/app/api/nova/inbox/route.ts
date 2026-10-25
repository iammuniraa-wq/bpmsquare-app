import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase, getAuthUser } from "@/lib/supabase-server";
import { tenantHasNovaSurfaces } from "@/lib/tenant";
import { allowedNovaTypes } from "@/lib/novaAccess";
import { hiddenEmailIds } from "@/lib/inbox/server";

/**
 * Nova pillar 4 — the inbox. A notification IS a comment that mentions
 * you (record_comments.mentions, 0089); this route joins that against the
 * caller's own read markers (0090) and resolves each target record's name
 * so the item reads like a sentence, not a UUID.
 *
 * GET  → { items, unread }
 * POST → mark read: { comment_ids: [...] } or { all: true }
 */

const LABEL: Record<string, string> = {
  accounts: "Account", contacts: "Contact", quotes: "Quotation",
  standard_quotes: "Quote", sales_orders: "Sales Order", cases: "Case", work_orders: "Work Order",
  invoices: "Invoice", assets: "Asset", suppliers: "Supplier",
  inventory: "Inventory item", purchase_orders: "Purchase Order", employees: "Employee",
  products: "Product", wfm_projects: "Project", opportunities: "Deal", rfqs: "RFQ", estimates: "Estimate", leads: "Lead",
  contract_projects: "Contract project",
  abm_programs: "ABM program", abm_targets: "ABM target account", inbound_emails: "Email",
};
const TABLE: Record<string, { table: string; nameCol: string; refCol?: string }> = {
  accounts:        { table: "accounts",         nameCol: "name", refCol: "ref" },
  contacts:        { table: "contacts",         nameCol: "name", refCol: "ref" },
  quotes:          { table: "quotes",           nameCol: "ref" },
  standard_quotes: { table: "standard_quotes",  nameCol: "ref" },
  sales_orders:    { table: "sales_orders",     nameCol: "ref" },
  cases:           { table: "service_cases",    nameCol: "ref" },
  work_orders:     { table: "work_orders",      nameCol: "ref" },
  invoices:        { table: "invoices",         nameCol: "ref" },
  assets:          { table: "assets",           nameCol: "name", refCol: "ref" },
  suppliers:       { table: "suppliers",        nameCol: "name", refCol: "ref" },
  inventory:       { table: "inventory_items",  nameCol: "name", refCol: "ref" },
  purchase_orders: { table: "purchase_orders",  nameCol: "ref" },
  employees:       { table: "employees",        nameCol: "first_name", refCol: "employee_code" },
  wfm_projects:    { table: "wfm_projects",     nameCol: "name", refCol: "ref" },
  products: { table: "products", nameCol: "name", refCol: "ref" },
  opportunities: { table: "opportunities", nameCol: "title", refCol: "ref" },
  rfqs: { table: "rfqs", nameCol: "title", refCol: "ref" },
  estimates: { table: "estimates", nameCol: "name", refCol: "ref" },
  leads: { table: "leads", nameCol: "title" },
  contract_projects: { table: "contract_projects", nameCol: "name", refCol: "ref" },
  abm_programs: { table: "abm_programs", nameCol: "name", refCol: "ref" },
  // A target has no name or ref of its own: the inbox shows its id; the record page names the company.
  abm_targets: { table: "abm_target_accounts", nameCol: "id" },
  // The mention shows an email by its subject, to a person a colleague on that channel chose to mention.
  inbound_emails: { table: "inbound_emails", nameCol: "subject" },
};

export async function GET() {
  let supabase, tenantId, userId, role;
  try {
    ({ supabase, tenantId, userId, role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (!(await tenantHasNovaSurfaces(supabase, tenantId))) {
    return NextResponse.json({ error: "This surface isn't enabled for your workspace" }, { status: 403 });
  }

  const user = await getAuthUser();
  const email = user?.email?.toLowerCase();
  if (!user || !email) return NextResponse.json({ items: [], unread: 0 });

  const admin = createAdminSupabase();
  const { data: mentions, error } = await admin
    .from("record_comments")
    .select("id, object_type, object_id, author_email, body, created_at")
    .eq("tenant_id", tenantId)
    .contains("mentions", [email])
    .order("created_at", { ascending: false })
    .limit(30);
  // Tables not migrated yet (0089/0090) -- an empty inbox is the right
  // degradation, never a broken bell.
  if (error) return NextResponse.json({ items: [], unread: 0 });

  // A mention on a record the caller may no longer see (module off, or no
  // view grant on its workcenter) must not surface its text or name.
  const visible = await allowedNovaTypes({
    supabase, tenantId, userId, role, types: (mentions ?? []).map((m) => m.object_type as string),
  });
  const granted = (mentions ?? []).filter((m) => visible.has(m.object_type as string));
  // An email is further limited to the channels the caller is on the team of.
  const mailIds = [...new Set(granted.filter((m) => m.object_type === "inbound_emails").map((m) => m.object_id as string))];
  const hiddenMail = mailIds.length ? await hiddenEmailIds(admin, tenantId, userId, role === "admin", mailIds) : new Set<string>();
  const rows = granted.filter((m) => !(m.object_type === "inbound_emails" && hiddenMail.has(m.object_id as string)));
  if (rows.length === 0) return NextResponse.json({ items: [], unread: 0 });

  const { data: reads } = await admin
    .from("nova_inbox_reads")
    .select("comment_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", user.id);
  const readSet = new Set((reads ?? []).map((r) => r.comment_id as string));

  // Resolve target names per object type, tenant-scoped (guardrails: the
  // ids come from our own rows, but the filter stays explicit).
  const byType = new Map<string, string[]>();
  for (const r of rows) {
    const t = r.object_type as string;
    if (!TABLE[t]) continue;
    byType.set(t, [...(byType.get(t) ?? []), r.object_id as string]);
  }
  const names = new Map<string, string>();
  await Promise.all([...byType.entries()].map(async ([type, ids]) => {
    const def = TABLE[type];
    const cols = ["id", def.nameCol, ...(def.refCol ? [def.refCol] : [])].join(", ");
    const { data } = await admin.from(def.table).select(cols).eq("tenant_id", tenantId).in("id", [...new Set(ids)]);
    for (const row of (data ?? []) as unknown as Record<string, string>[]) {
      names.set(`${type}:${row.id}`, row[def.nameCol] || (def.refCol ? row[def.refCol] : "") || "Untitled");
    }
  }));

  // A target account is named by its company.
  const targetIds = [...new Set(byType.get("abm_targets") ?? [])];
  if (targetIds.length > 0) {
    const { data: ts } = await admin.from("abm_target_accounts").select("id, account_id").eq("tenant_id", tenantId).in("id", targetIds);
    const targets = (ts ?? []) as { id: string; account_id: string }[];
    const { data: accs } = await admin.from("accounts").select("id, name").eq("tenant_id", tenantId).in("id", [...new Set(targets.map((t) => t.account_id))]);
    const accName = new Map(((accs ?? []) as { id: string; name: string }[]).map((a) => [a.id, a.name]));
    for (const t of targets) names.set(`abm_targets:${t.id}`, accName.get(t.account_id) ?? "Untitled");
  }

  const items = rows
    .filter((r) => TABLE[r.object_type as string])
    .map((r) => ({
      id: r.id as string,
      object_type: r.object_type as string,
      object_id: r.object_id as string,
      object_label: LABEL[r.object_type as string] ?? r.object_type,
      target_name: names.get(`${r.object_type}:${r.object_id}`) ?? "a record",
      author: (r.author_email as string | null)?.split("@")[0] ?? "someone",
      body: (r.body as string).slice(0, 180),
      created_at: r.created_at as string,
      unread: !readSet.has(r.id as string),
    }));

  return NextResponse.json({ items, unread: items.filter((i) => i.unread).length });
}

export async function POST(request: NextRequest) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  // Same gate as GET -- §10 rule 1, no Nova surface ungated. (Was the one
  // missing gate found by the 2026-08-22 readiness audit.)
  if (!(await tenantHasNovaSurfaces(supabase, tenantId))) {
    return NextResponse.json({ error: "This surface isn't enabled for your workspace" }, { status: 403 });
  }

  const user = await getAuthUser();
  const email = user?.email?.toLowerCase();
  if (!user || !email) return NextResponse.json({ ok: true });

  const body = await request.json().catch(() => null);
  const admin = createAdminSupabase();

  let ids: string[] = Array.isArray(body?.comment_ids)
    ? body.comment_ids.filter((x: unknown): x is string => typeof x === "string")
    : [];
  if (body?.all === true) {
    const { data } = await admin
      .from("record_comments").select("id")
      .eq("tenant_id", tenantId).contains("mentions", [email])
      .order("created_at", { ascending: false }).limit(30);
    ids = (data ?? []).map((r) => r.id as string);
  }
  if (ids.length === 0) return NextResponse.json({ ok: true });

  // Only comments that actually mention THIS user can be marked read --
  // a client-supplied id list is never trusted on its own.
  const { data: mine } = await admin
    .from("record_comments").select("id")
    .eq("tenant_id", tenantId).contains("mentions", [email]).in("id", ids);
  const allowed = (mine ?? []).map((r) => r.id as string);
  if (allowed.length === 0) return NextResponse.json({ ok: true });

  const { error } = await admin.from("nova_inbox_reads").upsert(
    allowed.map((commentId) => ({
      tenant_id: tenantId, user_id: user.id, comment_id: commentId,
    })),
    { onConflict: "user_id,comment_id", ignoreDuplicates: true }
  );
  if (error) {
    return NextResponse.json({ error: "Could not mark read — has migration 0090 been applied?" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
