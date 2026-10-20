import "server-only";
import { logChange } from "@/lib/changeLog";
import { emitEvent } from "@/lib/events/emit";
import { EVENTS } from "@/lib/events/catalog";
import { deriveProgress, ENGAGE_EVENTS, REACH_EVENTS, type LinkedDeal, type ProgressEvent, type ProgressMember, type ProgressVerdict } from "./progress";
import { PROGRESS_LABEL, type AbmProgram, type AbmRole, type AbmTargetAccount } from "./types";
import type { AbmCtx } from "./server";

// Runs the progress rules (progress.ts) against what actually happened.
// Nothing here runs by itself in the shell: a person presses "Check progress"
// (or a deal/member change calls it). The nightly subscriber is plays, A2.

type Db = Pick<AbmCtx, "supabase" | "admin" | "tenantId">;

export type TargetFacts = {
  target: AbmTargetAccount;
  members: (ProgressMember & { id: string })[];
  events: ProgressEvent[];
  deal: LinkedDeal | null;
};

/** Everything the rules need for a set of targets, in four tenant-filtered queries. */
export async function loadFacts(ctx: Db, targets: AbmTargetAccount[]): Promise<Map<string, TargetFacts>> {
  const out = new Map<string, TargetFacts>();
  if (targets.length === 0) return out;
  const ids = targets.map((t) => t.id);

  const { data: memberRows } = await ctx.supabase.from("abm_buying_group_members").select("id, target_account_id, contact_id, role").eq("tenant_id", ctx.tenantId).in("target_account_id", ids);
  const members = (memberRows ?? []) as { id: string; target_account_id: string; contact_id: string; role: AbmRole }[];
  const contactIds = [...new Set(members.map((m) => m.contact_id))];

  const names = new Map<string, string>();
  const events: (ProgressEvent & { contact_id: string })[] = [];
  if (contactIds.length > 0) {
    for (let i = 0; i < contactIds.length; i += 150) {
      const slice = contactIds.slice(i, i + 150);
      const [{ data: cs }, { data: ev }] = await Promise.all([
        ctx.supabase.from("contacts").select("id, name").eq("tenant_id", ctx.tenantId).in("id", slice),
        ctx.admin.from("domain_event").select("name, occurred_at, contact_id").eq("tenant_id", ctx.tenantId).in("contact_id", slice).in("name", [...REACH_EVENTS, ...ENGAGE_EVENTS]).order("occurred_at", { ascending: false }).limit(2000),
      ]);
      for (const c of (cs ?? []) as { id: string; name: string }[]) names.set(c.id, c.name);
      events.push(...((ev ?? []) as (ProgressEvent & { contact_id: string })[]));
    }
  }

  const dealIds = [...new Set(targets.map((t) => t.opportunity_id).filter((x): x is string => !!x))];
  const deals = new Map<string, LinkedDeal>();
  if (dealIds.length > 0) {
    const { data: ds } = await ctx.supabase.from("opportunities").select("id, ref, outcome, amount, closed_at").eq("tenant_id", ctx.tenantId).in("id", dealIds);
    for (const d of (ds ?? []) as { id: string; ref: string | null; outcome: LinkedDeal["outcome"]; amount: number | null; closed_at: string | null }[]) deals.set(d.id, d);
  }

  for (const t of targets) {
    out.set(t.id, {
      target: t,
      members: members.filter((m) => m.target_account_id === t.id).map((m) => ({ id: m.id, contact_id: m.contact_id, role: m.role, name: names.get(m.contact_id) ?? null })),
      events,
      deal: t.opportunity_id ? deals.get(t.opportunity_id) ?? null : null,
    });
  }
  return out;
}

export function verdictFor(facts: TargetFacts, program: Pick<AbmProgram, "required_roles">, strict: boolean): ProgressVerdict {
  const memberContacts = new Set(facts.members.map((m) => m.contact_id));
  return deriveProgress({
    current: facts.target.progress,
    currentSource: facts.target.progress_source,
    addedAt: facts.target.created_at,
    members: facts.members,
    requiredRoles: program.required_roles,
    engagedNeedsRequiredRoles: strict,
    events: facts.events.filter((e) => e.contact_id && memberContacts.has(e.contact_id)),
    deal: facts.deal,
  });
}

/** Applies the rules to these targets and writes what moved. Returns how many changed. */
export async function refreshProgress(ctx: AbmCtx, program: AbmProgram, targets: AbmTargetAccount[], accountNames: Map<string, string>, strict = true): Promise<number> {
  const facts = await loadFacts(ctx, targets.filter((t) => t.progress !== "dropped"));
  let changed = 0;
  for (const f of facts.values()) {
    const v = verdictFor(f, program, strict);
    if (!v.changed) continue;
    const now = new Date().toISOString();
    const { error } = await ctx.supabase.from("abm_target_accounts")
      .update({ progress: v.progress, progress_source: "rule", progress_reason: v.reason, progress_changed_at: now, progress_changed_by: null, updated_at: now })
      .eq("id", f.target.id).eq("tenant_id", ctx.tenantId);
    if (error) continue;
    changed++;
    await logChange(ctx.supabase, {
      tenantId: ctx.tenantId, objectType: "abm_target_accounts", objectId: f.target.id, objectLabel: `${accountNames.get(f.target.account_id) ?? "Account"} in ${program.name}`,
      action: "update", actorId: ctx.userId, actorEmail: ctx.email, changes: [{ field: "progress", from: PROGRESS_LABEL[f.target.progress], to: `${PROGRESS_LABEL[v.progress]} (by rule)` }],
    });
    await emitEvent(ctx.tenantId, {
      name: EVENTS.ABM_TARGET_PROGRESS_CHANGED, object_type: "abm_target", object_id: f.target.id, actor_id: ctx.userId, account_id: f.target.account_id,
      key: `${f.target.id}:${f.target.progress}->${v.progress}:${now.slice(0, 16)}`,
      payload: { program_id: program.id, target_account_id: f.target.id, from: f.target.progress, to: v.progress, source: "rule", rule: v.rule },
    }, ctx.admin);
  }
  return changed;
}

/** Let the rules look at one target again (after a person was added, a role changed, a deal linked). Never throws. */
export async function recheckTarget(ctx: AbmCtx, target: AbmTargetAccount): Promise<void> {
  try {
    const [{ data: program }, { data: acct }, { data: fresh }] = await Promise.all([
      ctx.supabase.from("abm_programs").select("*").eq("id", target.program_id).eq("tenant_id", ctx.tenantId).maybeSingle(),
      ctx.supabase.from("accounts").select("name").eq("id", target.account_id).eq("tenant_id", ctx.tenantId).maybeSingle(),
      ctx.supabase.from("abm_target_accounts").select("*").eq("id", target.id).eq("tenant_id", ctx.tenantId).maybeSingle(),
    ]);
    if (!program || !fresh) return;
    await refreshProgress(ctx, program as unknown as AbmProgram, [fresh as unknown as AbmTargetAccount], new Map([[target.account_id, (acct as { name?: string } | null)?.name ?? "Account"]]));
  } catch (e) {
    console.error("abm: progress check failed", e);
  }
}

/** Live evidence for the "why this status" popover: the rule's verdict recomputed from the stream, with dates. */
export async function explainTarget(ctx: Db, program: AbmProgram, target: AbmTargetAccount, strict = true): Promise<{ verdict: ProgressVerdict; evidence: { text: string; at: string }[] }> {
  const facts = (await loadFacts(ctx, [target])).get(target.id);
  if (!facts) return { verdict: { progress: target.progress, changed: false, rule: null, reason: "", evidence: [], held: null }, evidence: [] };
  const verdict = verdictFor(facts, program, strict);
  // The evidence behind the status as it stands: everything the rules would have counted, newest first.
  const probe = deriveProgress({
    current: "planned", currentSource: "rule", addedAt: target.created_at, members: facts.members, requiredRoles: [], engagedNeedsRequiredRoles: false,
    events: facts.events.filter((e) => facts.members.some((m) => m.contact_id === e.contact_id)), deal: null,
  });
  return { verdict, evidence: probe.evidence.slice(0, 8).map((e) => ({ text: e.text, at: e.at })) };
}
