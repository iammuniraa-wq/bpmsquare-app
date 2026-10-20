import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Account, Team } from "@/lib/types";
import type { TenantFeatures } from "@/lib/constants";
import { resolveCoverageForAccount } from "@/lib/coverage/resolve";
import { isSchemaPending } from "../pending";
import { nextInRotation } from "./roundRobin";

// Who gets a lead that has become ready for sales (docs/marketing-platform-
// architecture.md 4.3). The account's Coverage decides the owning team; the
// team's assignment_mode decides the person:
//   lead         the team lead (the same person Coverage already makes the
//                account owner)
//   round_robin  the next member in turn
// No Coverage (module off, or no segment matched) falls back to the
// workspace's oldest admin, and the reason is recorded so a gap shows as a
// chip on the lead instead of passing unseen. The account's own owner is never
// changed by a lead assignment.

export type AssignmentReason = "team_lead" | "round_robin" | "fallback_admin" | "unassigned";

export type Assignment = { owner_user_id: string | null; reason: AssignmentReason; team_id: string | null };

type Deps = { resolveCoverage?: typeof resolveCoverageForAccount };

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

  const { data: admins } = await admin
    .from("tenant_users").select("user_id, created_at")
    .eq("tenant_id", tenantId).eq("role", "admin").order("created_at", { ascending: true }).limit(1);
  const first = (admins ?? [])[0]?.user_id as string | undefined;
  return first ? { owner_user_id: first, reason: "fallback_admin", team_id: null } : { owner_user_id: null, reason: "unassigned", team_id: null };
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
