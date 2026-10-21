import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Account, Team } from "@/lib/types";
import type { TenantConfig, TenantFeatures } from "@/lib/constants";
import { resolveCoverageForAccount } from "@/lib/coverage/resolve";
import { isSchemaPending } from "../pending";
import { nextInRotation } from "./roundRobin";
import { handoverOf } from "./handover";

// Who gets a lead that has become ready for sales (docs/marketing-platform-
// architecture.md 4.3). The account's Coverage decides the owning team; the
// team's assignment_mode decides the person:
//   lead         the team lead (the same person Coverage already makes the
//                account owner)
//   round_robin  the next member in turn
// No Coverage (module off, or no segment matched) falls back first to the
// workspace's own list of people (Settings, Marketing, Hand-over), taken in
// turn, and then to the workspace's oldest admin; the reason is recorded so a
// gap shows as a chip on the lead instead of passing unseen. The account's own owner is never
// changed by a lead assignment.

export type AssignmentReason = "team_lead" | "round_robin" | "fallback_list" | "fallback_admin" | "unassigned";

export type Assignment = { owner_user_id: string | null; reason: AssignmentReason; team_id: string | null };

type Deps = { resolveCoverage?: typeof resolveCoverageForAccount; /** The workspace config, for its fallback list. */ config?: Partial<TenantConfig> | null };

export async function pickOwnerForLead(
  admin: SupabaseClient,
  tenantId: string,
  lead: { account_id: string },
  features: Partial<TenantFeatures> | null | undefined,
  deps: Deps = {},
): Promise<Assignment> {
  if (features?.coverage_model === true) {
    const { data: account } = await admin.from("accounts").select("*").eq("id", lead.account_id).eq("tenant_id", tenantId).maybeSingle();
    if (account) {
      const resolve = deps.resolveCoverage ?? resolveCoverageForAccount;
      const resolved = await resolve(tenantId, account as Account).catch(() => null);
      const team = resolved?.owner?.team as (Team & { assignment_mode?: string; last_assigned_user_id?: string | null }) | undefined;
      if (team) {
        if (team.assignment_mode === "round_robin") {
          const next = await rotate(admin, tenantId, team);
          if (next) return { owner_user_id: next, reason: "round_robin", team_id: team.id };
        } else if (team.lead_user_id) {
          return { owner_user_id: team.lead_user_id, reason: "team_lead", team_id: team.id };
        }
      }
    }
  }

  const fromList = await nextFallbackPerson(admin, tenantId, handoverOf(deps.config).fallback_user_ids);
  if (fromList) return { owner_user_id: fromList, reason: "fallback_list", team_id: null };

  const { data: admins } = await admin
    .from("tenant_users").select("user_id, created_at")
    .eq("tenant_id", tenantId).eq("role", "admin").order("created_at", { ascending: true }).limit(1);
  const first = (admins ?? [])[0]?.user_id as string | undefined;
  return first ? { owner_user_id: first, reason: "fallback_admin", team_id: null } : { owner_user_id: null, reason: "unassigned", team_id: null };
}

/** The lead of the team Coverage says owns this company, or null (Coverage off, nothing matched, or the team has no lead). */
export async function teamLeadForAccount(
  admin: SupabaseClient, tenantId: string, accountId: string, features: Partial<TenantFeatures> | null | undefined, deps: Deps = {},
): Promise<string | null> {
  if (features?.coverage_model !== true) return null;
  const { data: account } = await admin.from("accounts").select("*").eq("id", accountId).eq("tenant_id", tenantId).maybeSingle();
  if (!account) return null;
  const resolve = deps.resolveCoverage ?? resolveCoverageForAccount;
  const resolved = await resolve(tenantId, account as Account).catch(() => null);
  const team = resolved?.owner?.team as (Team & { lead_user_id?: string | null }) | undefined;
  return team?.lead_user_id ?? null;
}

/**
 * The next person on the workspace's own fallback list. Only people who still belong to THIS workspace count
 * (the list is re-checked against tenant_users every time). The turn is read from the leads already handed out
 * this way: whoever was given a lead longest ago goes next, and someone never given one goes first, in list order.
 * Two leads at the same instant can land on the same person; that costs a little fairness, never a lead.
 */
export async function nextFallbackPerson(admin: SupabaseClient, tenantId: string, listed: string[]): Promise<string | null> {
  if (listed.length === 0) return null;
  const { data: members, error } = await admin.from("tenant_users").select("user_id").eq("tenant_id", tenantId).in("user_id", listed);
  if (error) return null;
  const valid = new Set((members ?? []).map((m) => m.user_id as string));
  const people = listed.filter((id) => valid.has(id));
  if (people.length === 0) return null;

  const last = new Map<string, string>();
  const { data: given } = await admin
    .from("leads").select("owner_user_id, assigned_at")
    .eq("tenant_id", tenantId).eq("assignment_reason", "fallback_list").in("owner_user_id", people)
    .order("assigned_at", { ascending: false }).limit(200);
  for (const r of (given ?? []) as { owner_user_id: string | null; assigned_at: string | null }[]) {
    if (r.owner_user_id && r.assigned_at && r.assigned_at > (last.get(r.owner_user_id) ?? "")) last.set(r.owner_user_id, r.assigned_at);
  }
  let best = people[0];
  for (const id of people) {
    const a = last.get(id) ?? "";
    const b = last.get(best) ?? "";
    if (a < b) best = id;
  }
  return best;
}

/**
 * Next member of the team in turn. The pointer on the team is moved with a
 * compare-and-set (only if it still holds the value we read), so two leads
 * turning ready at once take different people; the loser re-reads once.
 */
async function rotate(admin: SupabaseClient, tenantId: string, team: { id: string; last_assigned_user_id?: string | null }): Promise<string | null> {
  const { data: rows, error } = await admin.from("team_members").select("user_id").eq("tenant_id", tenantId).eq("team_id", team.id);
  if (error) return null;
  const members = (rows ?? []).map((r) => r.user_id as string);
  if (members.length === 0) return null;

  let last = team.last_assigned_user_id ?? null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const next = nextInRotation(members, last);
    if (!next) return null;
    let q = admin.from("teams").update({ last_assigned_user_id: next }).eq("id", team.id).eq("tenant_id", tenantId);
    q = last ? q.eq("last_assigned_user_id", last) : q.is("last_assigned_user_id", null);
    const { data: won, error: uErr } = await q.select("id");
    if (uErr) {
      // The column is not there yet: still hand the lead out, just without remembering whose turn it was.
      if (isSchemaPending(uErr)) return next;
      return null;
    }
    if ((won ?? []).length > 0) return next;
    const { data: fresh } = await admin.from("teams").select("last_assigned_user_id").eq("id", team.id).eq("tenant_id", tenantId).maybeSingle();
    last = (fresh?.last_assigned_user_id as string | null | undefined) ?? null;
  }
  return null;
}
