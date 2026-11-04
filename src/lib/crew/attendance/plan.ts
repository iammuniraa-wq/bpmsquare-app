// plan(): the plain-code candidate gate (design 2, 5.2). For each site, read the facts through the injected reads, run the
// detectors, and ask for a model run only when something clears the threshold. A quiet site (or a quiet week) costs 0 tokens.

import { loadSiteFacts } from "./adapters";
import { ATTENDANCE_AGENT_KEY } from "./keys";
import type { RunRequest } from "./contract";
import { addDays } from "./dates";
import { planSite, type DetectOptions } from "./detectors";
import type { AttendanceReads, Sensitivity } from "./facts";
import { canViewSite } from "./scope";
import type { ViewerScope } from "./facts";

/** Shift-days the facts cover: enough for the 10 and 14 day person windows. */
export const PLAN_WINDOW_DAYS = 14;

export type AttendanceSettings = {
  sensitivity: Sensitivity;
  families: DetectOptions["families"];
  /** Sites chosen in the agent drawer; null/absent = all. */
  siteIds?: string[] | null;
};

export type PlanCtx = {
  reads: AttendanceReads;
  /** The workspace-local date the plan runs on (YYYY-MM-DD). The shift-day that just closed is the day before. */
  today: string;
  settings: AttendanceSettings;
  trigger?: "schedule" | "manual";
  /** A supervisor's "Run now" is planned through their scope; the scheduled plan passes null. */
  viewerScope?: ViewerScope | null;
};

export type PlanOutcome = {
  requests: RunRequest[];
  /** "Nothing to review. N sites checked." */
  sitesChecked: number;
  quietSites: number;
  /** The shift-days the plan covered. */
  window: { from: string; to: string };
  skipped: { siteId: string; reason: string }[];
};

export const dedupeKeyFor = (siteId: string, closedDay: string) => `${ATTENDANCE_AGENT_KEY}|site:${siteId}|day:${closedDay}`;

export async function planAttendanceDetailed(ctx: PlanCtx): Promise<PlanOutcome> {
  const to = addDays(ctx.today, -1);
  const from = addDays(to, -(PLAN_WINDOW_DAYS - 1));
  const all = await ctx.reads.listSiteIds();
  const chosen = ctx.settings.siteIds && ctx.settings.siteIds.length > 0 ? all.filter((id) => ctx.settings.siteIds!.includes(id)) : all;
  const sites = chosen.filter((id) => canViewSite(id, ctx.viewerScope ?? null));

  const out: PlanOutcome = { requests: [], sitesChecked: 0, quietSites: 0, window: { from, to }, skipped: [] };
  for (const siteId of sites) {
    try {
      const loaded = await loadSiteFacts(ctx.reads, { siteId, from, to, today: ctx.today, viewerScope: ctx.viewerScope });
      if (!loaded.ok) {
        out.skipped.push({ siteId, reason: loaded.error });
        continue;
      }
      out.sitesChecked++;
      const decision = planSite(loaded.data.facts, { sensitivity: ctx.settings.sensitivity, families: ctx.settings.families });
      if (!decision.start) {
        out.quietSites++;
        continue;
      }
      out.requests.push({
        agent_key: ATTENDANCE_AGENT_KEY,
        trigger: ctx.trigger ?? "schedule",
        trigger_ref: `daily:${to}`,
        dedupe_key: dedupeKeyFor(siteId, to),
        scope: { site_id: siteId, from, to },
        candidate_count: decision.candidates.length,
      });
    } catch (e) {
      out.skipped.push({ siteId, reason: `read_error:${e instanceof Error ? e.message.slice(0, 80) : "unknown"}` });
    }
  }
  return out;
}

export async function planAttendance(ctx: PlanCtx): Promise<RunRequest[]> {
  return (await planAttendanceDetailed(ctx)).requests;
}
