import { notFound, redirect } from "next/navigation";
import TraceView, { type TraceData } from "@/components/crew/TraceView";
import { ROUTES } from "@/lib/constants";
import { loadActorNames } from "@/lib/actorNames";
import { percentUsed, effectiveAgentCap } from "@/lib/crew/core/budget";
import { openCrew } from "@/lib/crew/server/access";
import { canSeeRuns } from "@/lib/crew/core/visibility";
import { findingsOfRun, loadRun, loadSettings, loadSteps, proposalsOfRun } from "@/lib/crew/server/store";
import { isAgentKey } from "@/lib/crew/registry";
import { requireWorkcenterView } from "@/lib/permissions";
import { requireFeature } from "@/lib/tenant";

// The trace of one run (design section 3.6). Same people who may see the agent's runs.

export default async function RunTracePage({ params }: { params: Promise<{ agent: string; id: string }> }) {
  const { agent, id } = await params;
  await requireWorkcenterView("crew");
  await requireFeature("crew");
  if (!isAgentKey(agent) || !/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const door = await openCrew(agent);
  if (!door.ok) {
    if (door.res.status === 404) notFound();
    redirect(ROUTES.dashboard);
  }
  const { ctx, entry } = door;
  const run = await loadRun(ctx.admin, ctx.tenantId, id);
  const settings = await loadSettings(ctx.admin, ctx.tenantId);
  if (!run || run.agent_key !== agent || !canSeeRuns(ctx, settings.get(agent).config.visibility)) notFound();

  const [steps, findings, proposals] = await Promise.all([loadSteps(ctx.admin, ctx.tenantId, id), findingsOfRun(ctx.admin, ctx.tenantId, id), proposalsOfRun(ctx.admin, ctx.tenantId, id)]);
  const names = await loadActorNames(ctx.admin, ctx.tenantId, proposals.flatMap((p) => ((p.payload as { recipient_ids?: string[] }).recipient_ids ?? [])));
  const cap = effectiveAgentCap(settings.get(agent).monthly_token_cap, entry!.defaults.monthlyTokenCap);

  const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  const left: string[] = [];
  for (const st of steps) {
    const out = st.output as { rejected?: { index: number; reason: string }[]; dropped?: string[]; unavailable?: string[] } | null;
    if (st.kind === "validate") for (const r of asArr(out?.rejected) as { reason: string }[]) left.push(`Left out: ${r.reason}`);
    if (st.kind === "gate") for (const d of asArr(out?.dropped) as string[]) left.push(`Left out: ${d}`);
    if (out?.unavailable) for (const u of out.unavailable) left.push(`Could not read: ${u}`);
    if (st.ok === false) left.push(`${String(st.name)} could not be read: ${String(st.error ?? "")}`);
  }
  for (const f of findings) for (const g of f.gaps ?? []) left.push(`Could not check: ${g}`);

  const trace: TraceData = {
    agent, agentName: entry!.name, accent: entry!.accent, trigger: run.trigger, because: run.trigger_ref ?? "", status: run.status, model: run.model, promptVersion: run.prompt_version,
    queuedAt: run.queued_at, startedAt: run.started_at, finishedAt: run.finished_at, tokensIn: run.input_tokens, tokensOut: run.output_tokens,
    percentOfCap: percentUsed(run.input_tokens + run.output_tokens, cap), error: run.error, note: run.nothing_to_report,
    isAdmin: ctx.role === "admin",
    steps: steps.map((x) => {
      const refs = (asArr(x.refs) as { type: string; id: string; label: string }[]).map((r) => ({ ...r, href: r.type === "opportunity" ? ROUTES.pipelineDetail(r.id) : null }));
      return { seq: Number(x.seq), kind: String(x.kind), name: String(x.name), id: null, ok: x.ok !== false, error: (x.error as string | null) ?? null, ms: Number(x.ms ?? 0), tokensIn: Number(x.tokens_in ?? 0), tokensOut: Number(x.tokens_out ?? 0), refs, input: x.input, output: x.output };
    }),
    concluded: findings.map((f) => ({ title: f.title, severity: f.severity, evidence: (f.evidence ?? []).map((e) => e.label) })),
    proposed: proposals.map((p) => ({ text: String((p.payload as { message?: unknown }).message ?? ""), status: p.status, to: (((p.payload as { recipient_ids?: string[] }).recipient_ids) ?? []).map((i) => names.get(i) ?? "A colleague") })),
    left,
  };
  // Citable ids ("s1") follow the order prefetch / tool steps were recorded.
  let n = 0;
  trace.steps = trace.steps.map((x) => (x.kind === "prefetch" || x.kind === "tool" ? { ...x, id: `s${++n}` } : x));
  return <TraceView t={trace} />;
}
