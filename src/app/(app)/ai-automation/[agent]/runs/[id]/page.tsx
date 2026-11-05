import { notFound, redirect } from "next/navigation";
import TraceView, { type TraceData } from "@/components/crew/TraceView";
import { ROUTES } from "@/lib/constants";
import { loadActorNames } from "@/lib/actorNames";
import { percentUsed, effectiveAgentCap } from "@/lib/crew/core/budget";
import { openCrew, viewerWithScope } from "@/lib/crew/server/access";
import { aliasRenderers } from "@/lib/crew/server/attendanceNames";
import { canSeeFinding, canSeeRun } from "@/lib/crew/core/visibility";
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
  const viewer = await viewerWithScope(ctx);
  if (!run || run.agent_key !== agent || !canSeeRun(viewer, run, settings.get(agent).config.visibility)) notFound();

  const [steps, allFindings, allProposals] = await Promise.all([loadSteps(ctx.admin, ctx.tenantId, id), findingsOfRun(ctx.admin, ctx.tenantId, id), proposalsOfRun(ctx.admin, ctx.tenantId, id)]);
  // A person-level finding of a site the viewer supervises is still hidden when its person is not theirs (and never the viewer themself).
  const findings = allFindings.filter((f) => canSeeFinding(viewer, f, settings.get(agent).config.visibility));
  const shown = new Set(findings.map((f) => f.id));
  const proposals = allProposals.filter((p) => !p.finding_id || shown.has(p.finding_id));
  const put = (await aliasRenderers(ctx.admin, ctx.tenantId, agent === "attendance" ? [id] : [])).get(id) ?? ((t: string) => t);
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
  for (const f of findings) for (const g of f.gaps ?? []) left.push(`Could not check: ${put(g)}`);

  const trace: TraceData = {
    agent, agentName: entry!.name, accent: entry!.accent, trigger: run.trigger, because: run.trigger_ref ?? "", status: run.status, model: run.model, promptVersion: run.prompt_version,
    queuedAt: run.queued_at, startedAt: run.started_at, finishedAt: run.finished_at, tokensIn: run.input_tokens, tokensOut: run.output_tokens,
    percentOfCap: percentUsed(run.input_tokens + run.output_tokens, cap), error: run.error, note: run.nothing_to_report,
    isAdmin: ctx.role === "admin",
    steps: steps.map((x) => {
      const refs = (asArr(x.refs) as { type: string; id: string; label: string }[]).map((r) => ({ ...r, href: r.type === "opportunity" ? ROUTES.pipelineDetail(r.id) : null }));
      return { seq: Number(x.seq), kind: String(x.kind), name: String(x.name), id: null, ok: x.ok !== false, error: (x.error as string | null) ?? null, ms: Number(x.ms ?? 0), tokensIn: Number(x.tokens_in ?? 0), tokensOut: Number(x.tokens_out ?? 0), refs, input: x.input, output: x.output };
    }),
    concluded: findings.map((f) => ({ title: put(f.title), severity: f.severity, evidence: (f.evidence ?? []).map((e) => put(e.label)) })),
    proposed: proposals.map((p) => ({ text: String((p.payload as { message?: unknown }).message ?? ""), status: p.status, to: p.action_key === "wfm.recheck" ? [`${((p.payload as { employee_ids?: string[] }).employee_ids ?? []).length} ${((p.payload as { employee_ids?: string[] }).employee_ids ?? []).length === 1 ? "person" : "people"}`] : (((p.payload as { recipient_ids?: string[] }).recipient_ids) ?? []).map((i) => names.get(i) ?? "A colleague") })),
    left,
  };
  // Citable ids ("s1") follow the order prefetch / tool steps were recorded.
  let n = 0;
  trace.steps = trace.steps.map((x) => (x.kind === "prefetch" || x.kind === "tool" ? { ...x, id: `s${++n}` } : x));
  return <TraceView t={trace} />;
}
