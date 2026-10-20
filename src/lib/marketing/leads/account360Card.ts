import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Account360Card, Account360Row, Tone } from "@/lib/account360/types";
import { ROUTES, type TenantConfig } from "@/lib/constants";
import { stageDefOf } from "../leadStages";
import { SCORE_LABEL, stageForScore, rubricOf } from "../scoring";
import { marketingConfigOf } from "../config";
import { isSchemaPending } from "../pending";
import { isLeadOverdue } from "./timing";
import { listWorkspacePeople, personLabel } from "./people";
import { bestLeadsByAccount } from "./queries";

// The Account 360 "Marketing" card: the account's best lead, its score and
// stage, and who has it. Built as data in the shape
// the drawer already draws (bpmsquarecore.md 10a), so the drawer gains no
// branch for it. Returns null while the lead columns do not exist yet, so the
// card simply is not offered rather than rendering broken.

const TONE: Record<string, Tone> = { new: "neutral", engaged: "neutral", ready: "good" };

export async function buildMarketingCard(admin: SupabaseClient, tenantId: string, accountId: string): Promise<Account360Card | null> {
  const [{ data: tenant }, best] = await Promise.all([
    admin.from("tenants").select("config").eq("id", tenantId).maybeSingle(),
    bestLeadsByAccount(admin, tenantId, [accountId]),
  ]);
  const { data: all, error } = await admin
    .from("leads").select("id").eq("tenant_id", tenantId).eq("account_id", accountId).limit(1);
  if (error) {
    if (!isSchemaPending(error)) console.error(`[leads] account card failed: ${error.message}`);
    return null;
  }
  const rubric = rubricOf(marketingConfigOf(tenant?.config as Partial<TenantConfig> | undefined).scoring);
  const lead = best.get(accountId);

  if (!lead) {
    return {
      id: "marketing", title: "Marketing", kind: "internal",
      subtitle: (all ?? []).length > 0 ? "No scored lead yet" : "No lead",
      empty: (all ?? []).length > 0 ? "The leads here have not been scored yet. Scores are worked out every fifteen minutes." : "Nobody at this company is being followed up as a lead.",
    };
  }

  const now = new Date();
  const band = lead.score != null ? stageForScore(lead.score, rubric.thresholds) : null;
  const people = lead.owner_user_id ? await listWorkspacePeople(admin, tenantId) : [];
  const owner = lead.owner_user_id ? personLabel(people.find((p) => p.user_id === lead.owner_user_id)) : "Nobody yet";
  const overdue = isLeadOverdue(lead.stage, lead.sla_due_at, now);

  const rows: Account360Row[] = [{
    title: lead.title ?? "Untitled lead",
    meta: `${stageDefOf(lead.stage).label} · ${owner}${overdue ? " · response overdue" : ""}`,
    value: lead.score != null ? String(lead.score) : undefined,
    tone: overdue ? "bad" : band ? TONE[band] : undefined,
    href: ROUTES.marketingLead(lead.id),
  }];

  return {
    id: "marketing", title: "Marketing", kind: "internal",
    subtitle: lead.score != null ? `${SCORE_LABEL[band!]} · ${lead.score} of 100` : "Not scored yet",
    stats: [
      { label: "Lead score", value: lead.score != null ? String(lead.score) : "—", hint: band ? SCORE_LABEL[band] : undefined, tone: overdue ? "bad" : band ? TONE[band] : "neutral" },
      { label: "Stage", value: stageDefOf(lead.stage).label, hint: owner },
    ],
    rows,
  };
}
