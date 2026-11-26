import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readAllPages } from "@/lib/pagedRead";
import { evaluateGate, flaggedOf, topFindings, type AwardCheck, type GateInput } from "./awardGate";
import { isMissingTable } from "./load";
import { VERDICTS, type Findings, type Verdict } from "./types";

// The server half of the award warning. Every query is on the service-role client and chains .eq("tenant_id", tenantId): another
// workspace's check can never apply to this one. A missing table (migration 0263 pending) and a supplier never checked both read as
// "nothing to warn about"; a read that fails for any other reason is reported so the route can say so instead of waving the award through.

export type AwardChecksRead = { checks: AwardCheck[]; failed: boolean };

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The newest saved check of each given supplier (any verdict), with the supplier's name and its strongest two findings. */
export async function loadAwardChecks(admin: SupabaseClient, tenantId: string, supplierIds: readonly string[]): Promise<AwardChecksRead> {
  const want = [...new Set(supplierIds.filter((x) => typeof x === "string" && ID.test(x)))].slice(0, 200);
  if (!want.length) return { checks: [], failed: false };
  const { data, error } = await readAllPages<{ id: string; supplier_id: string; checked_at: string; verdict: string; genuine_findings: Partial<Findings> | null }>((lo, hi) =>
    admin.from("supplier_checks").select("id, supplier_id, checked_at, verdict, genuine_findings").eq("tenant_id", tenantId).in("supplier_id", want)
      .order("checked_at", { ascending: false }).order("id", { ascending: true }).range(lo, hi));
  if (error) return { checks: [], failed: !isMissingTable(error) };
  const seen = new Set<string>();
  const newest = (data ?? []).filter((r) => {
    if (seen.has(r.supplier_id) || !(VERDICTS as readonly string[]).includes(r.verdict)) return false;
    seen.add(r.supplier_id);
    return true;
  });
  if (!newest.length) return { checks: [], failed: false };
  const { data: sups, error: supErr } = await admin.from("suppliers").select("id, name").eq("tenant_id", tenantId).in("id", newest.map((r) => r.supplier_id));
  if (supErr) return { checks: [], failed: true };
  const nameOf = new Map(((sups ?? []) as { id: string; name: string | null }[]).map((s) => [s.id, s.name ?? "This supplier"]));
  const checks = newest.filter((r) => nameOf.has(r.supplier_id)).map((r): AwardCheck => ({
    supplierId: r.supplier_id, name: nameOf.get(r.supplier_id)!, verdict: r.verdict as Verdict, findings: topFindings(r.genuine_findings, 2), checkedAt: r.checked_at,
  }));
  return { checks, failed: false };
}

export type GateOutcome =
  | { ok: true; flagged: AwardCheck[]; reason: string | null }
  | { ok: false; status: 422 | 503; code: string; error: string; extra: Record<string, unknown> };

export const GATE_UNREADABLE = "The Supplier check could not be read just now. Nothing was awarded; try again in a moment.";

/** Re-reads the newest verdict of the awarded suppliers and applies the rule. The caller writes nothing unless this answers ok. */
export async function enforceAwardGate(admin: SupabaseClient, tenantId: string, supplierIds: readonly string[], input: GateInput): Promise<GateOutcome> {
  const read = await loadAwardChecks(admin, tenantId, supplierIds);
  if (read.failed) return { ok: false, status: 503, code: "supplier_check_unreadable", error: GATE_UNREADABLE, extra: {} };
  const flagged = flaggedOf(read.checks);
  const verdict = evaluateGate(flagged, input);
  if (!verdict.ok) {
    return {
      ok: false, status: 422, code: verdict.code, error: verdict.message,
      extra: { suppliers: verdict.suppliers, flagged: flagged.map((f) => ({ supplier_id: f.supplierId, name: f.name, verdict: f.verdict, findings: f.findings })) },
    };
  }
  return { ok: true, flagged, reason: verdict.reason };
}
