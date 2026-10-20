import "server-only";
import { createAdminSupabase } from "@/lib/supabase-server";
import { ROUTES } from "@/lib/constants";
import type { Account360Card, Account360Suggestion } from "@/lib/account360/types";
import { roleGaps } from "./roles";
import { shortDate } from "./progress";
import { ABM_PROGRESS, PROGRESS_LABEL, ROLE_LABEL, TIER_LABEL, type AbmProgress, type AbmRole, type AbmTier } from "./types";

// The Account 360 card "In ABM programs" (docs/abm-architecture.md 9.6, bpmsquarecore 10a: a card is
// data). It never touches the account's health rating and adds no factor to it. A missing table reads
// as "not in any program", never an error.

type TargetRow = {
  id: string; program_id: string; tier: AbmTier; progress: AbmProgress; owner_user_id: string | null;
  next_step: string | null; next_step_due: string | null;
};
type ProgramRow = { id: string; name: string; status: string; required_roles: AbmRole[] };

const CLOSED: AbmProgress[] = ["won", "lost", "dropped"];

export async function buildAbmAccountCard(tenantId: string, accountId: string): Promise<{ card: Account360Card; suggestions: Account360Suggestion[] }> {
  const admin = createAdminSupabase();
  const empty = "Not in any program. Add this account from a program's Target accounts tab.";
  const blank = { card: { id: "abm", title: "In ABM programs", subtitle: "Not in any program", kind: "internal" as const, empty }, suggestions: [] as Account360Suggestion[] };

  const { data: tRows, error } = await admin
    .from("abm_target_accounts")
    .select("id, program_id, tier, progress, owner_user_id, next_step, next_step_due")
    .eq("tenant_id", tenantId).eq("account_id", accountId);
  if (error || !tRows || tRows.length === 0) return blank;
  const targets = tRows as unknown as TargetRow[];

  const { data: pRows } = await admin.from("abm_programs").select("id, name, status, required_roles").eq("tenant_id", tenantId).in("id", [...new Set(targets.map((t) => t.program_id))]);
  const programs = new Map(((pRows ?? []) as unknown as ProgramRow[]).map((p) => [p.id, p]));
  const { data: mRows } = await admin.from("abm_buying_group_members").select("target_account_id, role").eq("tenant_id", tenantId).in("target_account_id", targets.map((t) => t.id));
  const roles = new Map<string, { role: AbmRole }[]>();
  for (const m of (mRows ?? []) as { target_account_id: string; role: AbmRole }[]) roles.set(m.target_account_id, [...(roles.get(m.target_account_id) ?? []), { role: m.role }]);

  const live = targets.filter((t) => programs.get(t.program_id)?.status !== "archived");
  if (live.length === 0) return blank;
  const active = live.filter((t) => programs.get(t.program_id)?.status === "active");
  const best = [...live].filter((t) => t.progress !== "dropped").sort((a, b) => ABM_PROGRESS.indexOf(b.progress) - ABM_PROGRESS.indexOf(a.progress))[0];

  let people = 0;
  let gaps = 0;
  for (const t of live) {
    const m = roles.get(t.id) ?? [];
    people += m.length;
    if (!CLOSED.includes(t.progress)) gaps += roleGaps(programs.get(t.program_id)?.required_roles ?? [], m).length;
  }

  const card: Account360Card = {
    id: "abm",
    title: "In ABM programs",
    subtitle: `${live.length} program${live.length === 1 ? "" : "s"}`,
    kind: "internal",
    stats: [
      { label: "Programs", value: String(live.length), hint: `${active.length} active` },
      { label: "Best progress", value: best ? PROGRESS_LABEL[best.progress] : "—", tone: best && ["in_talks", "deal_open", "won"].includes(best.progress) ? "good" : "neutral" },
      { label: "Buying group", value: `${people} ${people === 1 ? "person" : "people"}`, hint: gaps > 0 ? `${gaps} ${gaps === 1 ? "gap" : "gaps"}` : "No gaps", tone: gaps > 0 ? "warn" : "neutral" },
    ],
    rows: live.slice(0, 8).map((t) => ({
      title: programs.get(t.program_id)?.name ?? "Program",
      meta: [TIER_LABEL[t.tier], t.next_step ? `next: ${t.next_step}${t.next_step_due ? ` by ${shortDate(`${t.next_step_due}T00:00:00Z`)}` : ""}` : null].filter(Boolean).join(" · "),
      value: PROGRESS_LABEL[t.progress],
      tone: ["in_talks", "deal_open", "won"].includes(t.progress) ? "good" as const : undefined,
      href: ROUTES.marketingAbmTarget(t.program_id, t.id),
    })),
  };

  const today = new Date().toISOString().slice(0, 10);
  const suggestions: Account360Suggestion[] = [];
  for (const t of live) {
    const program = programs.get(t.program_id);
    if (!program || CLOSED.includes(t.progress)) continue;
    if (t.tier === "one_to_one" && t.next_step && t.next_step_due && t.next_step_due < today) {
      suggestions.push({
        id: `abm-overdue-${t.id}`, title: `Next step overdue in ${program.name}`,
        detail: `"${t.next_step}" was due ${shortDate(`${t.next_step_due}T00:00:00Z`)}.`, urgency: "high", href: ROUTES.marketingAbmTarget(t.program_id, t.id),
      });
    }
    const missing = roleGaps(program.required_roles, roles.get(t.id) ?? []);
    if (t.progress === "engaged" && missing.length > 0) {
      suggestions.push({
        id: `abm-gap-${t.id}`, title: `Engaged in ${program.name}, but no ${ROLE_LABEL[missing[0].role].toLowerCase()} named`,
        detail: "Name the person who decides, so the program can move this company forward.", urgency: "medium", href: ROUTES.marketingAbmTarget(t.program_id, t.id),
      });
    }
  }
  return { card, suggestions };
}
