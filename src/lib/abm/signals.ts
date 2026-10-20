import "server-only";
import { createAdminSupabase } from "@/lib/supabase-server";
import { ABM_PROGRESS, ABM_TIERS, type AbmProgress, type AbmTier } from "./types";

// The three segment fields ABM adds (src/lib/marketingSegmentation.ts SEGMENT_FIELDS). They are not
// account columns, so, like has_active_amc, the caller that builds the record a segment is matched
// against computes them first (computeAccountSignals in src/lib/coverage/resolve.ts calls this).
// A missing table (migration pending) returns empty strings: every ABM rule then evaluates false.

export type AbmSignals = {
  /** Space-joined "ref name" of every active program the account is a target in ("contains" matches a ref or a name). */
  in_abm_program: string;
  /** The furthest progress across those programs (a Dropped company does not count). */
  abm_progress: string;
  /** The most personal tier across those programs: 1:1 before 1:few before 1:many. */
  abm_tier: string;
};

const NONE: AbmSignals = { in_abm_program: "", abm_progress: "", abm_tier: "" };

export function summariseAbm(
  rows: { progress: AbmProgress; tier: AbmTier; program: { ref: string | null; name: string; status: string } | null }[],
): AbmSignals {
  const live = rows.filter((r) => r.program && r.program.status === "active" && r.progress !== "dropped");
  if (live.length === 0) return NONE;
  const furthest = [...live].sort((a, b) => ABM_PROGRESS.indexOf(b.progress) - ABM_PROGRESS.indexOf(a.progress))[0].progress;
  const closest = [...live].sort((a, b) => ABM_TIERS.indexOf(a.tier) - ABM_TIERS.indexOf(b.tier))[0].tier;
  return {
    in_abm_program: live.map((r) => `${r.program?.ref ?? ""} ${r.program?.name ?? ""}`.trim()).join(", "),
    abm_progress: furthest,
    abm_tier: closest,
  };
}

export const ABM_SEGMENT_KEYS: readonly string[] = ["in_abm_program", "abm_progress", "abm_tier"];

/** The signals of many accounts in two queries (a campaign audience can be thousands of accounts). */
export async function computeAbmSignalsBulk(tenantId: string, accountIds: readonly string[]): Promise<Map<string, AbmSignals>> {
  const out = new Map<string, AbmSignals>();
  try {
    const admin = createAdminSupabase();
    const { data: t, error } = await admin.from("abm_target_accounts").select("account_id, program_id, progress, tier").eq("tenant_id", tenantId).limit(50000);
    if (error || !t || t.length === 0) return out;
    const { data: p } = await admin.from("abm_programs").select("id, ref, name, status").eq("tenant_id", tenantId).limit(5000);
    const programs = new Map(((p ?? []) as { id: string; ref: string | null; name: string; status: string }[]).map((x) => [x.id, x]));
    const wanted = new Set(accountIds);
    const byAccount = new Map<string, { progress: AbmProgress; tier: AbmTier; program: { ref: string | null; name: string; status: string } | null }[]>();
    for (const x of t as { account_id: string; program_id: string; progress: AbmProgress; tier: AbmTier }[]) {
      if (!wanted.has(x.account_id)) continue;
      byAccount.set(x.account_id, [...(byAccount.get(x.account_id) ?? []), { progress: x.progress, tier: x.tier, program: programs.get(x.program_id) ?? null }]);
    }
    for (const [id, rows] of byAccount) out.set(id, summariseAbm(rows));
  } catch {
    // Pending migration or a read failure: no account has ABM signals.
  }
  return out;
}

export async function computeAbmSignals(tenantId: string, accountId: string): Promise<AbmSignals> {
  try {
    const admin = createAdminSupabase();
    const { data: t, error } = await admin.from("abm_target_accounts").select("program_id, progress, tier").eq("tenant_id", tenantId).eq("account_id", accountId);
    if (error || !t || t.length === 0) return NONE;
    const { data: p } = await admin.from("abm_programs").select("id, ref, name, status").eq("tenant_id", tenantId).in("id", t.map((x) => x.program_id as string));
    const programs = new Map(((p ?? []) as { id: string; ref: string | null; name: string; status: string }[]).map((x) => [x.id, x]));
    return summariseAbm((t as { program_id: string; progress: AbmProgress; tier: AbmTier }[]).map((x) => ({ progress: x.progress, tier: x.tier, program: programs.get(x.program_id) ?? null })));
  } catch {
    return NONE;
  }
}
