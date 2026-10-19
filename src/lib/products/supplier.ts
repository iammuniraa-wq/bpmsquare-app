import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { missingColumnName } from "@/lib/pricing/quoteLineFlags";
import { nameKey } from "@/lib/import/server";
import type { ChangeEntry } from "@/lib/changeLog";
import type { ObjectSpec } from "@/lib/import/types";

// A product's preferred supplier (products.supplier_id, migration 0132).
//
// The owner applies SQL by hand, so every reader and writer has to behave
// while the column does not exist yet:
//   - a `select("*")` simply has no supplier_id key -> "no support yet",
//     which is NOT the same as "no supplier chosen" (null);
//   - a write that names the column fails with 42703 / PGRST204 -> the
//     column is dropped and the write retried (writeHeaderTolerant);
//   - screens hide the Supplier control instead of showing one that cannot save.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const SUPPLIER_COLUMN = "supplier_id";

/** True when this error is the database saying products.supplier_id is not there. */
export function isSupplierColumnMissing(error: { code?: string; message: string } | null | undefined): boolean {
  return !!error && missingColumnName(error) === SUPPLIER_COLUMN;
}

/** Whether rows read with `select("*")` carry the column. With no rows there
 *  is nothing to show a supplier on, so "absent" is the safe answer. */
export function rowsCarrySupplier(rows: readonly object[]): boolean {
  return rows.length > 0 && SUPPLIER_COLUMN in rows[0];
}

export type SupplierInput =
  | { present: false }
  | { present: true; id: string | null }
  | { present: true; invalid: true };

/** What a request body says about the supplier: absent (leave alone),
 *  null / "" (clear it), or an id to verify. Anything else is invalid. */
export function parseSupplierInput(body: Record<string, unknown>): SupplierInput {
  if (!(SUPPLIER_COLUMN in body)) return { present: false };
  const v = body[SUPPLIER_COLUMN];
  if (v === null || v === "") return { present: true, id: null };
  if (typeof v === "string" && UUID.test(v)) return { present: true, id: v };
  return { present: true, invalid: true };
}

export type SupplierMatch =
  | { ok: true; id: string }
  | { ok: false; reason: "unknown" | "ambiguous" };

/** Resolve a typed supplier NAME to an id: trimmed, case- and
 *  whitespace-insensitive. Two suppliers with the same name make the match
 *  ambiguous -- refuse rather than guess which one a bulk file meant. The
 *  list passed in must already be this tenant's suppliers. */
export function resolveSupplierName(name: string, suppliers: readonly { id: string; name: string }[]): SupplierMatch {
  const key = nameKey(name);
  const hits = suppliers.filter((s) => nameKey(s.name) === key);
  if (hits.length === 1) return { ok: true, id: hits[0].id };
  return { ok: false, reason: hits.length === 0 ? "unknown" : "ambiguous" };
}

/** The change-log entries for a product write, with the supplier shown by
 *  NAME ("Supplier") instead of an opaque uuid. `entries` is diffForLog's
 *  output for the whole patch; the raw supplier_id entry is swapped out. */
export function withSupplierNames(entries: ChangeEntry[], names: ReadonlyMap<string, string>): ChangeEntry[] {
  const name = (v: unknown) => (typeof v === "string" ? names.get(v) ?? v : null);
  return entries.map((e) => (e.field === SUPPLIER_COLUMN ? { field: "Supplier", from: name(e.from), to: name(e.to) } : e));
}

/** Data Workbench: drop the supplier columns from a spec while 0132 is pending,
 *  so no template or export offers a column that cannot be read or saved. */
export function withoutSupplierFields(spec: ObjectSpec): ObjectSpec {
  return { ...spec, fields: spec.fields.filter((f) => f.key !== SUPPLIER_COLUMN && f.key !== "supplier_name") };
}

/** Tenant-scoped supplier names for a set of ids (one query, none when empty). */
export async function supplierNamesById(
  supabase: SupabaseClient,
  tenantId: string,
  ids: readonly (string | null | undefined)[]
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => typeof x === "string" && x.length > 0))];
  const out = new Map<string, string>();
  if (unique.length === 0) return out;
  const { data } = await supabase.from("suppliers").select("id, name").eq("tenant_id", tenantId).in("id", unique);
  for (const row of data ?? []) out.set(row.id as string, row.name as string);
  return out;
}

/** A foreign id from a request body: it must resolve to a supplier of THIS
 *  tenant before it is saved (MULTI_TENANT_GUARDRAILS.md). */
export async function verifySupplier(
  supabase: SupabaseClient,
  tenantId: string,
  supplierId: string
): Promise<boolean> {
  const { data } = await supabase
    .from("suppliers").select("id").eq("id", supplierId).eq("tenant_id", tenantId).maybeSingle();
  return !!data;
}

// Positive answers only: a column that exists keeps existing, and the answer
// carries no tenant data. A negative answer is never kept, because the owner
// will run 0132 while the server is up.
let columnKnownPresent = false;

/** Does products.supplier_id exist yet? (One cheap probe, remembered once true.) */
export async function supplierColumnAvailable(supabase: SupabaseClient): Promise<boolean> {
  if (columnKnownPresent) return true;
  const { error } = await supabase.from("products").select(SUPPLIER_COLUMN).limit(1);
  if (isSupplierColumnMissing(error)) return false;
  if (!error) columnKnownPresent = true;
  return !error;
}

/** The tenant's active suppliers for a picker, or null while 0132 is pending
 *  (null = hide the control). A supplier already on the product stays in the
 *  list even if it has since gone inactive, so editing never blanks it. */
export async function supplierPickerOptions(
  supabase: SupabaseClient,
  tenantId: string,
  currentId?: string | null
): Promise<{ id: string; name: string }[] | null> {
  if (!(await supplierColumnAvailable(supabase))) return null;
  const { data } = await supabase
    .from("suppliers").select("id, name, status").eq("tenant_id", tenantId).order("name");
  return (data ?? [])
    .filter((s) => s.status === "active" || s.id === currentId)
    .map((s) => ({ id: s.id as string, name: s.name as string }));
}
