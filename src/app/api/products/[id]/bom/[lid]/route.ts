import { NextResponse, type NextRequest } from "next/server";
import { getAuthUser } from "@/lib/supabase-server";
import { logChange, type ChangeEntry } from "@/lib/changeLog";
import { parseBomLineInput } from "@/lib/products/bomInput";
import { bomContext, isUuid, BOM_LINE_COLUMNS } from "@/lib/products/bomServer";

type Params = { params: Promise<{ id: string; lid: string }> };

const LABEL: Record<string, string> = { qty: "Quantity", uom: "Unit", scrap_pct: "Scrap %", line_kind: "Kind", note: "Note", sort_order: "Order" };

/** The line, by its own id, but only if it belongs to this product in this tenant. */
async function findLine(ctx: Exclude<Awaited<ReturnType<typeof bomContext>>, Response>, parentId: string, lineId: string) {
  const { data } = await ctx.supabase
    .from("product_bom_lines")
    .select(BOM_LINE_COLUMNS)
    .eq("id", lineId).eq("tenant_id", ctx.tenantId).eq("parent_product_id", parentId)
    .maybeSingle();
  if (!data) return null;
  const { data: comp } = await ctx.supabase.from("products").select("name").eq("id", data.component_product_id).eq("tenant_id", ctx.tenantId).maybeSingle();
  const { data: parent } = await ctx.supabase.from("products").select("name").eq("id", parentId).eq("tenant_id", ctx.tenantId).maybeSingle();
  return { line: data as Record<string, unknown>, componentName: (comp?.name as string | undefined) ?? "component", parentName: (parent?.name as string | undefined) ?? null };
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const ctx = await bomContext(true);
  if (ctx instanceof Response) return ctx;
  const { id, lid } = await params;
  if (!isUuid(id) || !isUuid(lid)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const parsed = parseBomLineInput(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.message }, { status: 400 });
  if (Object.keys(parsed.fields).length === 0) return NextResponse.json({ error: "Nothing to change" }, { status: 400 });

  const found = await findLine(ctx, id, lid);
  if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const patch = { ...parsed.fields, updated_at: new Date().toISOString() };
  const { error } = await ctx.supabase.from("product_bom_lines").update(patch).eq("id", lid).eq("tenant_id", ctx.tenantId).eq("parent_product_id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const changes: ChangeEntry[] = Object.entries(parsed.fields)
    .filter(([k, v]) => JSON.stringify(found.line[k] ?? null) !== JSON.stringify(v ?? null) && !(k === "qty" && Number(found.line.qty) === v) && !(k === "scrap_pct" && Number(found.line.scrap_pct) === v))
    .map(([k, v]) => ({ field: `${found.componentName}: ${LABEL[k] ?? k}`, from: found.line[k] ?? null, to: v ?? null }));
  if (changes.length > 0) {
    const user = await getAuthUser();
    await logChange(ctx.supabase, {
      tenantId: ctx.tenantId, objectType: "products", objectId: id, objectLabel: found.parentName, action: "update",
      actorId: user?.id, actorEmail: user?.email, changes,
    });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const ctx = await bomContext(true);
  if (ctx instanceof Response) return ctx;
  const { id, lid } = await params;
  if (!isUuid(id) || !isUuid(lid)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const found = await findLine(ctx, id, lid);
  if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { error } = await ctx.supabase.from("product_bom_lines").delete().eq("id", lid).eq("tenant_id", ctx.tenantId).eq("parent_product_id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const user = await getAuthUser();
  await logChange(ctx.supabase, {
    tenantId: ctx.tenantId, objectType: "products", objectId: id, objectLabel: found.parentName, action: "update",
    actorId: user?.id, actorEmail: user?.email,
    changes: [{ field: "Component removed", from: `${found.componentName} × ${Number(found.line.qty)}`, to: null }],
  });
  return new NextResponse(null, { status: 204 });
}
