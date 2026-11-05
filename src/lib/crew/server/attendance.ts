import "server-only";
import { tenantMemberIds } from "@/lib/tender/roomServer";
import { attendanceReads, siteCommandChain, tenantAdminUserIds } from "@/lib/wfm/crewReads";
import { loadSiteFacts } from "../attendance/adapters";
import { addDays } from "../attendance/dates";
import { detectCandidates } from "../attendance/detectors";
import { buildDigest } from "../attendance/digest";
import { buildLeadDefinition, engineSettings, leadToolAdapters } from "../attendance/leadBridge";
import { attendanceSystemPrompt, attendanceUserPrompt } from "../attendance/prompt";
import { SUBMISSION_SCHEMA } from "../attendance/submission";
import { validateAttendanceSubmission } from "../attendance/submit";
import { ATTENDANCE_FAMILIES } from "../attendance/facts";
import { BANNED_TERMS, EXTRA_BANNED } from "../attendance/wording";
import { dailySlot, manualDedupeKey } from "../core/schedule";
import { agentEntry } from "../registry";
import type { AgentDefinition, PlanCtx, RunRequest } from "../types";
import type { AttendanceReads } from "../attendance/facts";
import type { AgentRuntime, Prepared } from "./runtime";
import { hasRunForDay } from "./store";
import { ROUTES } from "@/lib/constants";

// Attendance Anomalies, wired into the shared runner (docs/design/nova-crew-agents.md section 5). The engine (src/lib/crew/attendance/**) is pure and reads
// nothing itself: this file is where it meets the database, through src/lib/wfm/crewReads.ts (tenant-scoped, aliased before the model sees anything).
//
// A run is ONE site over a window of shift-days. prepare() reads the site's facts, runs the plain detectors and builds the digest (step s1), the alias map
// (alias -> real id, saved on the run, never shown to the model) and who is addressed. The model may call the read tools and then submits findings, which
// the engine's validator checks and this runtime maps to the shared persist shape. The agent never contacts an employee: its only proposals are a recheck
// a supervisor edits and sends as their own message, and a note shown to the site team on the finding itself.

const entry = agentEntry("attendance")!;
// One run reads the same site several times (the digest, then each tool the model calls). The reads are remembered for the life of the run object, keyed by
// tenant and run as well, so nothing can be shared between runs or workspaces. A plan() pass has no run and reads fresh.
const memos = new WeakMap<object, Map<string, Promise<unknown>>>();
function reads(ctx: { admin: PlanCtx["admin"]; tenantId: string; scope?: object; runId?: string }): AttendanceReads {
  const base = attendanceReads(ctx.admin, ctx.tenantId);
  if (!ctx.scope || !ctx.runId) return base;
  let cache = memos.get(ctx.scope);
  if (!cache) memos.set(ctx.scope, (cache = new Map()));
  const once = <T>(fn: string, args: unknown[], load: () => Promise<T>): Promise<T> => {
    const key = `${ctx.tenantId}|${ctx.runId}|${fn}|${JSON.stringify(args)}`;
    if (!cache!.has(key)) cache!.set(key, load());
    return cache!.get(key) as Promise<T>;
  };
  return {
    getConfig: () => once("config", [], () => base.getConfig()),
    listSiteIds: () => once("sites", [], () => base.listSiteIds()),
    getSite: (id) => once("site", [id], () => base.getSite(id)),
    listSiteEmployeeIds: (id, from, to) => once("people", [id, from, to], () => base.listSiteEmployeeIds(id, from, to)),
    getSummaryForRange: (from, to, ids) => once("summary", [from, to, ids], () => base.getSummaryForRange(from, to, ids)),
    getPunchFlagsForRange: (from, to, ids) => once("flags", [from, to, ids], () => base.getPunchFlagsForRange(from, to, ids)),
  };
}

const base = buildLeadDefinition((ctx) => reads(ctx));

async function plan(ctx: PlanCtx): Promise<RunRequest[]> {
  const manual = ctx.trigger === "manual";
  if (!manual) {
    const slot = dailySlot("attendance", ctx.settings.config.schedule ?? entry.defaults.schedule, ctx.now, ctx.timezone);
    if (!slot.due) return [];
    // The plan runs on every 15-minute tick once the slot has passed; a day already planned costs one cheap query, not a re-read of every site.
    if (await hasRunForDay(ctx.admin, ctx.tenantId, "attendance", slot.day)) return [];
  }
  const requests = await base.plan(ctx);
  const hour = manualDedupeKey("attendance", ctx.now).split("|").pop();
  return manual ? requests.map((r) => ({ ...r, trigger_ref: "Run now", dedupe_key: `${r.dedupe_key}|manual:${hour}` })) : requests;
}

export const attendanceDefinition: AgentDefinition = {
  ...base,
  title: entry.name,
  requires: { features: ["crew", "crew_attendance", "wfm"] },
  triggers: { schedule: entry.defaults.schedule },
  plan,
  defaults: entry.defaults,
};

type Strip = { dates: string[]; rostered: number[]; present: number[]; flagged: number[] };
type RunState = { digest: ReturnType<typeof buildDigest>; recipientsFor: (type: "employee" | "site", subjectId: string) => string[] };
export type AttendanceSnapshot = { site: string; strip: Strip; marked: Record<string, string[]> };

export const attendanceRuntime: AgentRuntime = {
  adapters: leadToolAdapters((ctx) => reads(ctx)),
  banned: [...BANNED_TERMS, ...EXTRA_BANNED],
  kinds: ATTENDANCE_FAMILIES,
  findingsSchema: SUBMISSION_SCHEMA,
  system: attendanceSystemPrompt,

  async prepare(ctx): Promise<Prepared> {
    const { site_id: siteId, from, to } = ctx.scope;
    if (!siteId || !from || !to) throw new Error("This run has no site and days to look at.");
    const eng = engineSettings(ctx.settings);
    const loaded = await loadSiteFacts(reads(ctx), { siteId, from, to, today: addDays(to, 1) });
    if (!loaded.ok) throw new Error(`The site could not be read (${loaded.error}).`);
    const { facts, aliases } = loaded.data;
    const digest = buildDigest(facts, detectCandidates(facts, { sensitivity: eng.sensitivity, families: eng.families }));

    // Who is addressed: the site's chain of command plus the extra recipients the admin chose (members only), never the person a finding is about.
    // A site with no supervisor or approver set falls back to the workspace admins, so a suggestion never lands with nobody.
    const chain = await siteCommandChain(ctx.admin, ctx.tenantId, siteId);
    const fallback = chain.length === 0 ? await tenantAdminUserIds(ctx.admin, ctx.tenantId) : [];
    const extras = await tenantMemberIds(ctx.admin, ctx.tenantId, ctx.settings.config.recipient_ids ?? []);
    const recipientsFor = (type: "employee" | "site", subjectId: string): string[] => [
      ...new Set([...chain.filter((c) => type === "site" || c.employeeId !== subjectId).map((c) => c.userId), ...fallback, ...extras]),
    ];

    const snapshot: AttendanceSnapshot = {
      site: digest.site.alias,
      strip: { dates: digest.days.map((d) => d.date), rostered: digest.days.map((d) => d.rostered), present: digest.days.map((d) => d.present), flagged: digest.days.map((d) => d.late + d.missing_out + d.outside) },
      marked: {},
    };
    const prepared: Prepared = {
      user: attendanceUserPrompt({ digest, digestStep: "s1" }),
      prefetch: { name: "attendance digest", output: digest, refs: [{ type: "wfm_site", id: siteId, label: digest.site.alias }] },
      permittedRecipients: () => null,
      bucketOf: () => "-",
      seenBy: (subjectId) => recipientsFor(subjectId === siteId ? "site" : "employee", subjectId),
      closesAt: () => null,
      labelOf: () => "Attendance recheck",
      hrefFor: (ref) => (ref.type === "wfm_site" ? ROUTES.wfmLiveBoard : null),
      members: (ids) => tenantMemberIds(ctx.admin, ctx.tenantId, ids),
      snapshot: snapshot as unknown as Record<string, unknown>,
      unavailable: [],
      aliasMap: aliases,
      toolIds: [...new Set(digest.candidates.flatMap((c) => c.members)), digest.site.alias],
      state: { digest, recipientsFor } satisfies RunState,
    };
    return prepared;
  },

  submission: {
    validate(raw, steps, prepared) {
      const st = prepared.state as RunState;
      const snap = prepared.snapshot as unknown as AttendanceSnapshot;
      const out = validateAttendanceSubmission(raw, steps, { digest: st.digest, aliases: prepared.aliasMap!, recipientsFor: st.recipientsFor, marked: snap.marked });
      return { accepted: out.accepted, rejected: out.rejected };
    },
  },
};
