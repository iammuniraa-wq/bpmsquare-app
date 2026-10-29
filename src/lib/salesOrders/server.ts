import "server-only";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireTenantUser } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";
import { isSchemaPending } from "@/lib/marketing/pending";
import { cleanRules } from "./rules";
import type { SalesOrder, SalesOrderLine, SalesOrderType } from "./types";

import { readAllPages } from "@/lib/pagedRead";
// Shared plumbing of the /api/sales-orders* routes: the guard every route starts with, the "database update
// pending" answer, and the few reads several routes repeat. Everything is tenant-scoped by the caller's tenantId.

export const SALES_ORDER_BUNDLE = "scripts/run-bundle-21-sales-orders-2026-10-23.sql";
export const FEATURE_OFF = "Sales Orders isn't enabled for your workspace";

export type OrderRow = SalesOrder & { cancelled_at: string | null; cancel_reason: string | null; sent_at: string | null; created_by: string | null };

export type Ctx = { supabase: SupabaseClient; tenantId: string; userId: string; role: string };

/** The session, the tenant, and the module flag. Throws a { status, message } the route turns into JSON. */
export async function guard(): Promise<Ctx> {
  const ctx = (await requireTenantUser()) as Ctx;
  if (!(await tenantHasFeature(ctx.supabase, ctx.tenantId, "sales_orders"))) {
    throw Object.assign(new Error(FEATURE_OFF), { status: 403 });
  }
  return ctx;
}

export function failure(e: unknown): NextResponse {
  const err = e as { status?: number; message?: string };
  return NextResponse.json({ error: err.message ?? "Unauthorized" }, { status: err.status ?? 401 });
}

/** True when a query failed only because migration 0212 has not been applied yet. */
export const pending = (err: { code?: string; message?: string } | null | undefined): boolean => isSchemaPending(err);

/** What every route answers (503) when it needs a table that is not there yet. */
export function needsUpdate(): NextResponse {
  return NextResponse.json(
    { error: "A database update is needed before Sales Orders can be used.", needsDatabaseUpdate: true, bundle: SALES_ORDER_BUNDLE },
    { status: 503 },
  );
}

/** The 200 a list answers while the tables are missing: an empty list the screen can explain. */
export function emptyPending(extra: Record<string, unknown> = {}): NextResponse {
  return NextResponse.json({ rows: [], total: 0, page: 1, page_size: 25, pages: 1, needsDatabaseUpdate: true, bundle: SALES_ORDER_BUNDLE, ...extra });
}

export type LoadedOrder = { order: OrderRow; erpLinked: boolean };

/**
 * One order of this tenant, plus whether an ERP has accepted it (a connector_links row). `kind` tells a missing
 * order from a missing table, so a route can answer 404 or the update message.
 */
export async function loadOrder(
  db: SupabaseClient,
  tenantId: string,
  id: string,
): Promise<{ kind: "ok"; value: LoadedOrder } | { kind: "missing" } | { kind: "pending" } | { kind: "error"; message: string }> {
  const { data, error } = await db.from("sales_orders").select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (error) return pending(error) ? { kind: "pending" } : { kind: "error", message: error.message };
  if (!data) return { kind: "missing" };
  return { kind: "ok", value: { order: data as OrderRow, erpLinked: await orderErpLinked(db, tenantId, id) } };
}

/** An ERP link exists for this order (the ERP accepted it). A missing connector table means no link. */
export async function orderErpLinked(db: SupabaseClient, tenantId: string, orderId: string): Promise<boolean> {
  const { data, error } = await db.from("connector_links").select("id").eq("tenant_id", tenantId).eq("object_type", "sales_orders").eq("object_id", orderId).limit(1);
  if (error) return false;
  return (data ?? []).length > 0;
}

export async function loadLines(db: SupabaseClient, tenantId: string, orderId: string): Promise<SalesOrderLine[]> {
  const { data } = await readAllPages((lo, hi) => db.from("sales_order_lines").select("*").eq("order_id", orderId).eq("tenant_id", tenantId).order("line_no").order("id", { ascending: true }).range(lo, hi));
  return ((data ?? []) as SalesOrderLine[]).slice().sort((a, b) => a.line_no - b.line_no);
}

/** A type as the app uses it: rules cleaned, template defaulted. */
export function shapeType(row: Record<string, unknown>): SalesOrderType {
  const tpl = row.template && typeof row.template === "object" && !Array.isArray(row.template) ? (row.template as SalesOrderType["template"]) : { blocks: [] };
  return {
    id: row.id as string,
    tenant_id: row.tenant_id as string,
    name: row.name as string,
    prefix: row.prefix as string,
    pricing_mode: row.pricing_mode === "external" ? "external" : "internal",
    template: { ...tpl, blocks: Array.isArray(tpl.blocks) ? tpl.blocks : [] },
    rules: cleanRules(row.rules),
    is_default: row.is_default === true,
    active: row.active !== false,
    sort_order: Number(row.sort_order ?? 0),
  };
}

export async function loadTypes(db: SupabaseClient, tenantId: string, opts: { activeOnly?: boolean } = {}): Promise<{ types: SalesOrderType[]; pending: boolean }> {
  let q = db.from("sales_order_types").select("*").eq("tenant_id", tenantId).order("sort_order");
  if (opts.activeOnly) q = q.eq("active", true);
  const { data, error } = await q;
  if (error) return { types: [], pending: pending(error) };
  return { types: ((data ?? []) as Record<string, unknown>[]).map(shapeType), pending: false };
}

/** A UUID-shaped string: anything else cannot be an id and is refused before it reaches a query. */
export const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/**
 * Product ids on incoming lines are foreign ids: they must resolve to this tenant's products. `strict` (a
 * request body) refuses an unknown id; otherwise (lines copied from a source row) it is nulled, so a stray id
 * in old data can never carry another tenant's product onto an order.
 */
export async function checkLineProducts<T extends { product_id: string | null }>(
  db: SupabaseClient,
  tenantId: string,
  lines: T[],
  strict: boolean,
): Promise<{ ok: true; lines: T[] } | { ok: false; error: string }> {
  const ids = [...new Set(lines.map((l) => l.product_id).filter((x): x is string => !!x))];
  if (ids.length === 0) return { ok: true, lines };
  const { data, error } = await db.from("products").select("id").eq("tenant_id", tenantId).in("id", ids);
  if (error) return strict ? { ok: false, error: "Product not found" } : { ok: true, lines: lines.map((l) => ({ ...l, product_id: null })) };
  const known = new Set(((data ?? []) as { id: string }[]).map((r) => r.id));
  if (strict && ids.some((id) => !known.has(id))) return { ok: false, error: "Product not found" };
  return { ok: true, lines: lines.map((l) => (l.product_id && known.has(l.product_id) ? l : { ...l, product_id: null })) };
}
