import "server-only";
import { ROUTES } from "@/lib/constants";
import { loadActorNames } from "@/lib/actorNames";
import { loadTenderCrewFacts } from "@/lib/tender/crewFacts";
import { percentUsed, effectiveAgentCap } from "../core/budget";
import { tileStatus } from "../core/settings";
import { agentModule } from "../definitions";
import { AGENTS, type AgentEntry } from "../registry";
import type { AgentKey, AgentSettings, Finding, Proposal } from "../types";
import type { AgentSettingsDTO, CrewView, FindingDTO, ProposalDTO, RunDTO, TileDTO } from "../viewTypes";
import { canSeeFinding, canSeeRuns } from "../core/visibility";
import { viewerOf, type CrewCtx } from "./access";
import { aiConfigured, crewDisabled } from "./model";
import { agentTokensUsed, listFindings, listProposals, listRuns, loadSettings, type RunRow } from "./store";

// The data behind the AI automation screens, built once per page load for ONE viewer. Everything a viewer is not allowed to see is dropped
// here, on the server (these tables have no member policy, so this is the only filter): findings by canSeeFinding, runs by canSeeRuns.

const runDTO = (r: RunRow, name: string): RunDTO => ({
  id: r.id, agent: r.agent_key, agentName: name, trigger: r.trigger, because: r.trigger_ref ?? "", status: r.status, at: r.finished_at ?? r.started_at ?? r.queued_at,
  tokens: r.input_tokens + r.output_tokens, findings: r.findings_count, proposals: r.proposals_count, note: r.nothing_to_report, error: r.error,
});

async function visuals(ctx: CrewCtx, rows: readonly Finding[]): Promise<Map<string, FindingDTO["visual"]>> {
  const out = new Map<string, FindingDTO["visual"]>();
  const ids = [...new Set(rows.filter((f) => f.agent_key === "tender_watch").map((f) => f.subject_id))].slice(0, 30);
  if (ids.length === 0) return out;
  try {
    const { facts } = await loadTenderCrewFacts(ctx.admin, ctx.tenantId, ids, { now: new Date(), timezone: ctx.tenant.timezone });
    for (const f of facts) {
      out.set(f.deal_id, {
        pricedPct: f.boq && f.boq.lines > 0 ? Math.round((f.boq.priced / f.boq.lines) * 100) : null,
        daysLeft: f.days_to_close, unpriced: f.boq?.unpriced ?? null, lines: f.boq?.lines ?? null,
      });
    }
  } catch { /* the card simply has no visual */ }
  return out;
}

export async function loadCrewView(ctx: CrewCtx, only: AgentKey | null): Promise<CrewView> {
  const { admin, tenantId } = ctx;
  const settings = await loadSettings(admin, tenantId);
  const empty: CrewView = { pending: settings.pending, isAdmin: ctx.role === "admin", workspacePaused: false, platformStopped: crewDisabled(), tiles: [], findings: [], proposals: [], runs: [], runsVisible: false, settings: {} };
  const entries = ctx.agents.filter((a) => !only || a.key === only);
  if (settings.pending) {
    return { ...empty, tiles: entries.map((e) => tile(ctx, e, settings.get(e.key), { pending: true, used: 0, lastRun: null, open: 0 })) };
  }

  const ws = settings.get("_workspace");
  const used = new Map<AgentKey, number>();
  await Promise.all(entries.map(async (e) => { used.set(e.key, await agentTokensUsed(admin, tenantId, e.key)); }));

  const runsAll = await listRuns(admin, tenantId, only, only ? 50 : 80);
  const allFindings = await listFindings(admin, tenantId, { agent: only, statuses: ["open", "seen"], limit: 200 });
  const visible = allFindings.rows.filter((f) => entries.some((e) => e.key === f.agent_key) && canSeeFinding(viewerOf(ctx), f, settings.get(f.agent_key).config.visibility));

  const tiles: TileDTO[] = entries.map((e) => {
    const lastRun = runsAll.rows.find((r) => r.agent_key === e.key && (r.status === "done" || r.status === "failed")) ?? null;
    const open = visible.filter((f) => f.agent_key === e.key).length;
    return tile(ctx, e, settings.get(e.key), { pending: false, used: used.get(e.key) ?? 0, lastRun, open, ws: ws.paused });
  });

  const props = await listProposals(admin, tenantId, { findingIds: visible.map((f) => f.id), status: ["pending"] });
  const names = await loadActorNames(admin, tenantId, props.flatMap((p) => ((p.payload as { recipient_ids?: string[] }).recipient_ids ?? [])));
  const vis = await visuals(ctx, visible);

  const findings: FindingDTO[] = visible.map((f) => ({
    id: f.id, agent: f.agent_key, kind: f.kind, severity: f.severity, title: f.title, body: f.body, evidence: f.evidence ?? [], gaps: f.gaps ?? [], status: f.status,
    createdAt: f.created_at, subjectId: f.subject_id, href: f.agent_key === "tender_watch" ? ROUTES.pipelineDetail(f.subject_id) : null, runId: f.run_id,
    visual: vis.get(f.subject_id) ?? null,
  }));

  const proposals: ProposalDTO[] = props.map((p: Proposal) => ({
    id: p.id, findingId: p.finding_id ?? "", actionKey: p.action_key, message: String((p.payload as { message?: unknown }).message ?? ""),
    toNames: (((p.payload as { recipient_ids?: string[] }).recipient_ids) ?? []).map((id) => names.get(id) ?? "A colleague"), status: p.status, expiresAt: p.expires_at,
    canDecide: p.approver_ids.includes(ctx.userId) && Date.parse(p.expires_at) > Date.now() && !!agentModule(p.agent_key),
  })).filter((p) => p.findingId);

  const settingsDto: CrewView["settings"] = {};
  for (const e of entries) {
    const s = settings.get(e.key);
    const cap = effectiveAgentCap(s.monthly_token_cap, e.defaults.monthlyTokenCap);
    const u = used.get(e.key) ?? 0;
    const dto: AgentSettingsDTO = {
      enabled: s.enabled, paused: s.paused, config: { ...s.config, digest_optin: undefined, visibility: undefined }, cap, used: u, percent: percentUsed(u, cap),
      digestOn: (s.config.digest_optin ?? []).includes(ctx.userId), needsTimezone: e.key === "tender_watch" && !ctx.tenant.hasTimezone,
    };
    settingsDto[e.key] = dto;
  }

  const runs = runsAll.rows
    .filter((r) => entries.some((e) => e.key === r.agent_key) && canSeeRuns(viewerOf(ctx), settings.get(r.agent_key).config.visibility))
    .map((r) => runDTO(r, AGENTS.find((a) => a.key === r.agent_key)?.name ?? r.agent_key));

  return {
    pending: false, isAdmin: ctx.role === "admin", workspacePaused: ws.paused, platformStopped: crewDisabled(), tiles, findings, proposals, runs,
    runsVisible: entries.some((e) => canSeeRuns(viewerOf(ctx), settings.get(e.key).config.visibility)), settings: settingsDto,
  };
}

function tile(
  ctx: CrewCtx, e: AgentEntry, s: AgentSettings,
  x: { pending: boolean; used: number; lastRun: RunRow | null; open: number; ws?: boolean },
): TileDTO {
  const cap = effectiveAgentCap(s.monthly_token_cap, e.defaults.monthlyTokenCap);
  return {
    key: e.key, name: e.name, purpose: e.purpose, logo: e.logo, accent: e.accent, href: e.href,
    status: tileStatus({
      engineReady: e.engine === "ready" && !!agentModule(e.key), dbPending: x.pending, enabled: s.enabled, paused: s.paused, workspacePaused: x.ws === true,
      platformStopped: crewDisabled(), aiConfigured: aiConfigured(), overCap: x.used >= cap, needsTimezone: e.key === "tender_watch" && !ctx.tenant.hasTimezone,
    }),
    lastRunAt: x.lastRun ? (x.lastRun.finished_at ?? x.lastRun.queued_at) : null, lastRunNote: x.lastRun?.status === "failed" ? "The last run failed" : x.lastRun?.nothing_to_report ?? null,
    openFindings: x.open, used: x.used, cap, percent: percentUsed(x.used, cap),
  };
}

