import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { assertObjectFeature } from "@/lib/objectFeatures";
import { resolveItemTypes, sanitizeItemTypeConfig } from "@/lib/products/itemTypes";
import { getTenantItemTypeConfig, itemTypeUsage } from "@/lib/products/itemTypesServer";

async function admin() {
  try {
    const ctx = await requireTenantUser();
    if (ctx.role !== "admin") return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
    const gate = await assertObjectFeature(ctx.tenantId, "products");
    if (gate) return { error: gate };
    return { supabase: ctx.supabase, tenantId: ctx.tenantId };
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return { error: NextResponse.json({ error: err.message }, { status: err.status }) };
  }
}

export async function GET() {
  const ctx = await admin();
  if ("error" in ctx) return ctx.error;
  const config = await getTenantItemTypeConfig(ctx.supabase, ctx.tenantId);
  return NextResponse.json({
    item_types: config.item_types ?? {},
    types: resolveItemTypes(config),
    usage: await itemTypeUsage(ctx.supabase, ctx.tenantId),
  });
}

export async function PUT(request: NextRequest) {
  const ctx = await admin();
  if ("error" in ctx) return ctx.error;

  const body = (await request.json().catch(() => null)) as { item_types?: unknown } | null;
  const parsed = sanitizeItemTypeConfig(body?.item_types);
  if (!parsed.ok) return NextResponse.json({ error: parsed.message }, { status: 400 });

  // A custom type that products still carry can be hidden, not removed: removing
  // it would leave those products with a type the workspace no longer knows.
  const before = await getTenantItemTypeConfig(ctx.supabase, ctx.tenantId);
  const kept = new Set((parsed.value.custom ?? []).map((x) => x.key));
  const dropped = (before.item_types?.custom ?? []).filter((x) => !kept.has(x.key));
  if (dropped.length > 0) {
    const usage = await itemTypeUsage(ctx.supabase, ctx.tenantId);
    const inUse = dropped.find((x) => (usage[x.key] ?? 0) > 0);
    if (inUse) {
      return NextResponse.json({ error: `${usage[inUse.key]} product${usage[inUse.key] === 1 ? " is" : "s are"} still "${inUse.label}". Hide it instead of removing it.` }, { status: 409 });
    }
  }

  const db = createAdminSupabase();
  const { data: current, error: readErr } = await db.from("tenants").select("config").eq("id", ctx.tenantId).single();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  const merged = { ...(current?.config ?? {}), item_types: parsed.value };
  const { error } = await db.from("tenants").update({ config: merged }).eq("id", ctx.tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, item_types: parsed.value });
}
