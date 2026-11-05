import "server-only";
import { ROUTES } from "@/lib/constants";
import { tenantMemberIds } from "@/lib/tender/roomServer";
import { loadTenderCrewFacts } from "@/lib/tender/crewFacts";
import { dayKey } from "@/lib/tender/rules";
import { briefOf, tenderAdapters } from "../adapters/tender";
import type { AgentRuntime } from "../server/runtime";
import { lastDoneRun } from "../server/store";
import {
  candidateReasons, fingerprintBucket, findingRecipients, permittedRecipients, snapshotOf, TENDER_BANNED, TENDER_KINDS, thresholdsFor, type TenderSnapshot,
} from "./gate";
import { tenderSystemPrompt, tenderUserPrompt, TENDER_FINDINGS_SCHEMA } from "./prompt";

// Tender Watch's runtime: how one run is prepared (the batched prefetch, step s1) and how its findings are fingerprinted, addressed and linked.
// Every figure the model sees comes from loadTenderCrewFacts; nothing is computed by the model.

export const tenderRuntime: AgentRuntime = {
  adapters: tenderAdapters,
  banned: TENDER_BANNED,
  kinds: TENDER_KINDS,
  findingsSchema: TENDER_FINDINGS_SCHEMA,
  system: tenderSystemPrompt,

  async prepare(ctx, run) {
    const ids = [...ctx.candidateIds];
    const r = await loadTenderCrewFacts(ctx.admin, ctx.tenantId, ids, { now: ctx.now, timezone: ctx.timezone });
    const byId = new Map(r.facts.map((f) => [f.deal_id, f]));
    const t = thresholdsFor(ctx.settings.config.sensitivity, ctx.settings.config.watch_window_days);
    const prev = (await lastDoneRun(ctx.admin, ctx.tenantId, "tender_watch"))?.snapshot as { deals?: TenderSnapshot } | null;
    const reasons: Record<string, string[]> = {};
    for (const f of r.facts) reasons[`d${ids.indexOf(f.deal_id) + 1}`] = candidateReasons(f, prev?.deals ?? null, t);
    const brief = { today: dayKey(ctx.now, ctx.timezone), ...briefOf(ctx, r.facts) };

    return {
      user: tenderUserPrompt({ todayIso: dayKey(ctx.now, ctx.timezone), briefStep: "s1", brief, unavailable: r.unavailable, thresholds: t, reasons }),
      prefetch: { name: "tender brief", output: brief, refs: r.facts.map((f) => ({ type: "opportunity", id: f.deal_id, label: f.ref ?? f.title })) },
      permittedRecipients: (draft) => permittedRecipients(draft, byId.get(draft.subject?.id)),
      bucketOf: (kind, id) => fingerprintBucket(kind, byId.get(id)),
      seenBy: (id) => findingRecipients(byId.get(id)),
      closesAt: (id) => byId.get(id)?.closing_at ?? null,
      labelOf: (id) => byId.get(id)?.ref ?? byId.get(id)?.title ?? "Tender",
      hrefFor: (ref) => (ref.type === "opportunity" ? ROUTES.pipelineDetail(ref.id) : null),
      members: (list) => tenantMemberIds(ctx.admin, ctx.tenantId, list),
      snapshot: { deals: { ...(prev?.deals ?? {}), ...snapshotOf(r.facts) } },
      unavailable: r.unavailable,
    };
  },
};
