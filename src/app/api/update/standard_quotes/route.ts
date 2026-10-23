import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, getAuthUser } from "@/lib/supabase-server";
import { assertObjectFeature } from "@/lib/objectFeatures";
import { resolvePermissions, canEditWorkcenter } from "@/lib/permissions";
import { readImportBody } from "@/lib/import/server";
import { summariseUpdate, updateRows, type PreparedUpdate } from "@/lib/import/updateServer";
import { computeStandardQuoteTotals, clampPct, clampAmount } from "@/lib/standardQuoteTotals";
import { mergeCfValues } from "@/lib/customData";
import type { RowOutcome } from "@/lib/import/types";

// Bulk update of standard quote HEADERS, matched on real id only (bpmsquarecore section 3).
// Mirrors the allowlist of PATCH /api/standard-quotes/[id] minus what has its own action UI or
// side effects: status (sent/accepted/rejected emit events and dispatch to the ERP), the deal
// link, the template, the contact and the lines. Discount, tax and shipping feed the stored
// total, so they are recomputed here exactly as the PATCH route does -- and, because a sent quote
// is an offer a customer holds, changed on a DRAFT quote only. Custom (cf_) columns merge into the
// quote's custom_data without touching its other keys.
const TEXT_KEYS = ["intro_text", "notes", "terms"] as const;
const DATE_KEYS = ["valid_until", "inquiry_date"] as const;
const COMMERCIAL_KEYS = ["header_discount_pct", "tax_pct", "shipping_amount"] as const;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

type Before = {
  id: string; status: string; subtotal: number;
  header_discount_pct: number; tax_pct: number; shipping_amount: number;
  custom_data?: Record<string, unknown> | null;
};

export async function POST(request: NextRequest) {
  let supabase, tenantId, userId, role;
  try {
    ({ supabase, tenantId, userId, role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  // A tenant without the module cannot read or write its data in bulk
  // either -- the gate is the same question the nav and the v1 API ask.
  const gate = await assertObjectFeature(tenantId, "standard_quotes");
  if (gate) return gate;
  const perms = await resolvePermissions(supabase, tenantId, userId, role);
  if (!canEditWorkcenter(perms, "standard_quotes")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const rows = readImportBody(await request.json());
  if (!rows) return NextResponse.json({ error: "No rows provided" }, { status: 400 });

  const ids = [...new Set(rows.map((r) => r.values.id?.trim()).filter((x): x is string => !!x))];
  const { data: beforeRows } = ids.length > 0
    ? await supabase.from("standard_quotes").select("*").in("id", ids).eq("tenant_id", tenantId)
    : { data: [] };
  const beforeById = new Map(((beforeRows ?? []) as Before[]).map((b) => [b.id, b]));

  const prepared: PreparedUpdate[] = [];
  const outcomes: RowOutcome[] = [];
  const now = new Date().toISOString();

  for (const { rowNum, values } of rows) {
    const id = values.id?.trim();
    if (!id) { outcomes.push({ rowNum, status: "failed", reason: "Record ID is required to update a row" }); continue; }
    const before = beforeById.get(id);
    // Unknown here means "not in this workspace" -- updateRows would say the same, but only after
    // the totals logic below had nothing to read.
    if (!before) { outcomes.push({ rowNum, status: "failed", reason: `No record with id "${id}" found in this workspace` }); continue; }

    const patch: Record<string, unknown> = {};
    let bad: string | null = null;

    for (const key of TEXT_KEYS) if (key in values) patch[key] = values[key]?.trim() || null;
    for (const key of DATE_KEYS) {
      if (!(key in values)) continue;
      const v = values[key]?.trim() ?? "";
      if (v && !ISO_DATE.test(v)) { bad = `${key} must be a date (YYYY-MM-DD)`; break; }
      patch[key] = v || null;
    }
    if (bad) { outcomes.push({ rowNum, status: "failed", reason: bad }); continue; }

    const commercial = COMMERCIAL_KEYS.filter((k) => k in values && values[k]?.trim());
    if (commercial.length > 0) {
      if (before.status !== "draft") {
        outcomes.push({ rowNum, status: "failed", reason: "Discount, tax and shipping can only change on a draft quote" });
        continue;
      }
      for (const key of commercial) {
        const n = Number(values[key].replace(/,/g, ""));
        if (!Number.isFinite(n) || n < 0) { bad = `${key} must be a number, zero or more`; break; }
        patch[key] = key === "shipping_amount" ? clampAmount(n) : clampPct(n);
      }
      if (bad) { outcomes.push({ rowNum, status: "failed", reason: bad }); continue; }
      const discount = (patch.header_discount_pct as number | undefined) ?? before.header_discount_pct;
      const tax = (patch.tax_pct as number | undefined) ?? before.tax_pct;
      const shipping = (patch.shipping_amount as number | undefined) ?? before.shipping_amount;
      patch.total = computeStandardQuoteTotals(before.subtotal, discount, tax, shipping).total;
    }

    // A database without 0209 returns no custom_data key at all: nothing to merge into.
    if ("custom_data" in before) {
      const merged = mergeCfValues(before.custom_data, values);
      if (merged) patch.custom_data = merged;
    }

    if (Object.keys(patch).length === 0) { outcomes.push({ rowNum, status: "skipped", reason: "No mapped columns to update" }); continue; }
    prepared.push({ rowNum, id, patch: { ...patch, updated_at: now }, diffPatch: patch });
  }

  if (prepared.length === 0) return NextResponse.json(summariseUpdate(outcomes));
  const user = await getAuthUser();
  return NextResponse.json(await updateRows(supabase, "standard_quotes", tenantId, prepared, outcomes, {
    objectType: "standard_quotes", labelField: "ref", actorId: user?.id, actorEmail: user?.email,
  }));
}
