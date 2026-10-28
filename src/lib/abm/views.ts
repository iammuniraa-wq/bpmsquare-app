import "server-only";
import { listMembersForPicker } from "@/lib/sales/opportunityServer";
import { isMissingRelation, TARGET_COLUMNS, PROGRAM_COLUMNS, type AbmCtx } from "./server";
import { getAbmBuyingStages, type BuyingStage } from "./stage";
import { groupSummary, roleGaps, type RoleGap } from "./roles";
import { computeResults, type ProgramResults, type ResultDeal } from "./results";
import type { AbmBuyingGroupMember, AbmProgram, AbmRole, AbmTargetAccount, AbmProgress } from "./types";

import { readAllPages } from "@/lib/pagedRead";
// Read models for the ABM screens and the routes that mirror them. Every
// query chains .eq("tenant_id", tenantId); a pending migration reads as
// `missing: true`, never an exception.

type Reader = Pick<AbmCtx, "supabase" | "admin" | "tenantId">;

export type UserNames = Map<string, string>;

/** Colleague names for owner columns. Capped at 200 members, the same ceiling the deal pickers use. */
export async function userNames(ctx: Pick<AbmCtx, "admin" | "tenantId">): Promise<UserNames> {
  try {
    const members = await listMembersForPicker(ctx.admin, ctx.tenantId);
    return new Map(members.map((m) => [m.user_id, m.name ?? m.email ?? "Someone"]));
  } catch {
    return new Map();
  }
}

export type ProgramListRow = AbmProgram & { counts: Record<AbmProgress, number>; target_total: number };

export async function listPrograms(ctx: Reader): Promise<{ rows: ProgramListRow[]; missing: boolean }> {
  const { data, error } = await ctx.supabase.from("abm_programs").select(PROGRAM_COLUMNS).eq("tenant_id", ctx.tenantId).order("created_at", { ascending: false }).limit(2000);
  if (error) return { rows: [], missing: isMissingRelation(error) };
  const programs = (data ?? []) as unknown as AbmProgram[];
  const counts = new Map<string, Record<AbmProgress, number>>();
  if (programs.length > 0) {
    const { data: t } = await readAllPages((lo, hi) => ctx.supabase.from("abm_target_accounts").select("program_id, progress").eq("tenant_id", ctx.tenantId).order("id", { ascending: true }).range(lo, hi));
    for (const r of (t ?? []) as { program_id: string; progress: AbmProgress }[]) {
      const c = counts.get(r.program_id) ?? { planned: 0, reached: 0, engaged: 0, in_talks: 0, deal_open: 0, won: 0, lost: 0, dropped: 0 };
      c[r.progress]++;
      counts.set(r.program_id, c);
    }
  }
  const zero = { planned: 0, reached: 0, engaged: 0, in_talks: 0, deal_open: 0, won: 0, lost: 0, dropped: 0 };
  return {
    rows: programs.map((p) => {
      const c = counts.get(p.id) ?? zero;
      return { ...p, counts: c, target_total: Object.values(c).reduce((a, b) => a + b, 0) };
    }),
    missing: false,
  };
}

export type MemberView = AbmBuyingGroupMember & { contact_name: string; contact_role: string | null; last_engagement: string | null };

export type TargetRow = {
  target: AbmTargetAccount;
  account: { id: string; name: string; city: string | null; industry: string | null };
  stage: BuyingStage | null;
  members: { id: string; role: AbmRole; is_primary: boolean }[];
  summary: { text: string; hasGap: boolean };
  gaps: RoleGap[];
  ownerName: string | null;
};

export async function loadProgramTargets(ctx: Reader, program: AbmProgram, names?: UserNames): Promise<{ rows: TargetRow[]; missing: boolean }> {
  const { data, error } = await ctx.supabase.from("abm_target_accounts").select(TARGET_COLUMNS).eq("tenant_id", ctx.tenantId).eq("program_id", program.id).order("created_at").limit(2000);
  if (error) return { rows: [], missing: isMissingRelation(error) };
  const targets = (data ?? []) as unknown as AbmTargetAccount[];
  if (targets.length === 0) return { rows: [], missing: false };

  const accountIds = [...new Set(targets.map((t) => t.account_id))];
  const accounts = new Map<string, TargetRow["account"]>();
  for (let i = 0; i < accountIds.length; i += 150) {
    const { data: a } = await ctx.supabase.from("accounts").select("id, name, city, industry").eq("tenant_id", ctx.tenantId).in("id", accountIds.slice(i, i + 150));
    for (const r of (a ?? []) as TargetRow["account"][]) accounts.set(r.id, r);
  }
  const members = new Map<string, TargetRow["members"]>();
  const ids = targets.map((t) => t.id);
  for (let i = 0; i < ids.length; i += 150) {
    const { data: m } = await ctx.supabase.from("abm_buying_group_members").select("id, target_account_id, role, is_primary").eq("tenant_id", ctx.tenantId).in("target_account_id", ids.slice(i, i + 150));
    for (const r of (m ?? []) as { id: string; target_account_id: string; role: AbmRole; is_primary: boolean }[]) {
      const list = members.get(r.target_account_id) ?? [];
      list.push({ id: r.id, role: r.role, is_primary: r.is_primary });
      members.set(r.target_account_id, list);
    }
  }
  const stages = await getAbmBuyingStages(ctx.tenantId, accountIds);
  const owners = names ?? (await userNames(ctx));

  return {
    missing: false,
    rows: targets.map((t) => {
      const ms = members.get(t.id) ?? [];
      return {
        target: t,
        account: accounts.get(t.account_id) ?? { id: t.account_id, name: "Account", city: null, industry: null },
        stage: stages.get(t.account_id) ?? null,
        members: ms,
        summary: groupSummary(program.required_roles, ms),
        gaps: roleGaps(program.required_roles, ms),
        ownerName: t.owner_user_id ? owners.get(t.owner_user_id) ?? null : null,
      };
    }),
  };
}

export async function loadProgramResults(ctx: Reader, program: AbmProgram): Promise<{ results: ProgramResults; missing: boolean }> {
  const { data, error } = await readAllPages((lo, hi) => ctx.supabase.from("abm_target_accounts").select("id, account_id, tier, progress, opportunity_id").eq("tenant_id", ctx.tenantId).eq("program_id", program.id).order("id", { ascending: true }).range(lo, hi));
  if (error) return { results: computeResults([], [], { metric: program.goal_metric, target: program.goal_target }), missing: isMissingRelation(error) };
  const targets = (data ?? []) as { id: string; account_id: string; tier: AbmTargetAccount["tier"]; progress: AbmProgress; opportunity_id: string | null }[];
  const dealIds = [...new Set(targets.map((t) => t.opportunity_id).filter((x): x is string => !!x))];
  const deals: ResultDeal[] = [];
  for (let i = 0; i < dealIds.length; i += 150) {
    const { data: d } = await ctx.supabase.from("opportunities").select("id, outcome, amount").eq("tenant_id", ctx.tenantId).in("id", dealIds.slice(i, i + 150));
    deals.push(...((d ?? []) as ResultDeal[]));
  }
  return { results: computeResults(targets, deals, { metric: program.goal_metric, target: program.goal_target }), missing: false };
}

/** One target with its program, account and buying group, for the target-account screen. */
export async function loadTargetBundle(ctx: Reader, targetId: string) {
  const { data: t, error } = await ctx.supabase.from("abm_target_accounts").select(TARGET_COLUMNS).eq("id", targetId).eq("tenant_id", ctx.tenantId).maybeSingle();
  if (error) return { missing: isMissingRelation(error), bundle: null };
  if (!t) return { missing: false, bundle: null };
  const target = t as unknown as AbmTargetAccount;
  const [{ data: p }, { data: a }, { data: m }] = await Promise.all([
    ctx.supabase.from("abm_programs").select(PROGRAM_COLUMNS).eq("id", target.program_id).eq("tenant_id", ctx.tenantId).maybeSingle(),
    ctx.supabase.from("accounts").select("id, name, city, industry, ref").eq("id", target.account_id).eq("tenant_id", ctx.tenantId).maybeSingle(),
    ctx.supabase.from("abm_buying_group_members").select("id, tenant_id, target_account_id, contact_id, role, is_primary, owner_user_id, notes, added_by, added_via, custom_data, created_at, updated_at").eq("tenant_id", ctx.tenantId).eq("target_account_id", targetId).order("created_at"),
  ]);
  if (!p || !a) return { missing: false, bundle: null };
  const members = (m ?? []) as unknown as AbmBuyingGroupMember[];
  const contactIds = members.map((x) => x.contact_id);
  const contacts = new Map<string, { name: string; role: string | null }>();
  if (contactIds.length > 0) {
    const { data: cs } = await ctx.supabase.from("contacts").select("id, name, role").eq("tenant_id", ctx.tenantId).in("id", contactIds);
    for (const c of (cs ?? []) as { id: string; name: string; role: string | null }[]) contacts.set(c.id, { name: c.name, role: c.role ?? null });
  }
  const lastByContact = new Map<string, string>();
  if (contactIds.length > 0) {
    const { data: ev } = await ctx.admin.from("domain_event").select("contact_id, name, occurred_at").eq("tenant_id", ctx.tenantId).in("contact_id", contactIds)
      .in("name", ["email.clicked", "email.interest", "quote.opened", "quote.accepted", "form.submitted", "whatsapp.replied", "web.page_viewed", "email.delivered", "quote.sent"]).order("occurred_at", { ascending: false }).limit(1000);
    for (const e of (ev ?? []) as { contact_id: string; occurred_at: string }[]) if (!lastByContact.has(e.contact_id)) lastByContact.set(e.contact_id, e.occurred_at);
  }
  const memberViews: MemberView[] = members.map((x) => ({
    ...x, contact_name: contacts.get(x.contact_id)?.name ?? "Person", contact_role: contacts.get(x.contact_id)?.role ?? null, last_engagement: lastByContact.get(x.contact_id) ?? null,
  }));
  return {
    missing: false,
    bundle: {
      target,
      program: p as unknown as AbmProgram,
      account: a as { id: string; name: string; city: string | null; industry: string | null; ref: string | null },
      members: memberViews,
    },
  };
}
