import "server-only";
import { diffForLog, logChange } from "@/lib/changeLog";
import { insertWithMasterRef } from "@/lib/masterRef";
import { isSchemaPending } from "@/lib/marketing/pending";
import type { JourneyCtx } from "./access";
import { readinessProblems, sanitizeJourney, templateById } from "./definition";
import { goLiveChecks, type GoLiveCheck } from "./preview";
import { backfill } from "./runner";
import { loadJourneyRow, type LoadedJourney } from "./store";
import type { JourneyDefinition } from "./types";

// Changing journeys. Journeys are select-only for members, so every write is on
// the service-role client after journeyAccess(), with the tenant on every query,
// and each mutation is written to change history through the session client.

export class JourneyError extends Error {
  constructor(public status: number, message: string, public extra: Record<string, unknown> = {}) { super(message); }
}

/** The foreign ids inside a definition belong to this workspace, and the topic exists. Checked on save and again on every send. */
async function verifyReferences(ctx: JourneyCtx, def: JourneyDefinition): Promise<void> {
  const topicKeys = new Set(ctx.env.topics.map((t) => t.key));
  for (const s of def.steps) {
    if (s.kind !== "send_newsletter") continue;
    if (s.topic && !topicKeys.has(s.topic)) throw new JourneyError(422, "That subject is not one of this workspace's topics.");
    if (!s.newsletter_version_id) continue;
    const { data, error } = await ctx.admin.from("newsletter_versions").select("id").eq("id", s.newsletter_version_id).eq("tenant_id", ctx.tenantId).maybeSingle();
    if (error && isSchemaPending(error)) throw new JourneyError(503, "The Newsletter Studio is waiting for a database update.");
    if (!data) throw new JourneyError(422, "That newsletter version could not be found.");
  }
}

export async function createJourney(ctx: JourneyCtx, input: { name: string; template: string }): Promise<{ id: string; ref: string | null }> {
  const tpl = templateById(input.template) ?? templateById("blank");
  if (!tpl) throw new JourneyError(422, "Unknown template.");
  const name = input.name.trim().slice(0, 120) || tpl.name;
  const definition = tpl.build();
  const { data, error } = await insertWithMasterRef<{ id: string; ref: string | null }>(ctx.admin, "journeys", ctx.tenantId, {
    tenant_id: ctx.tenantId, name, status: "draft", definition, trigger_name: definition.trigger.event, version: 1, created_by: ctx.userId,
  }, "id, ref");
  if (error || !data) throw error ?? new JourneyError(500, "Could not create the journey.");
  await logChange(ctx.supabase, { tenantId: ctx.tenantId, objectType: "journeys", objectId: data.id, objectLabel: data.ref ?? name, action: "create", actorId: ctx.userId });
  return data;
}

export async function updateJourney(ctx: JourneyCtx, id: string, input: { name?: unknown; definition?: unknown }): Promise<LoadedJourney> {
  const before = await loadJourneyRow(ctx.admin, ctx.tenantId, id);
  if (!before) throw new JourneyError(404, "Not found");
  if (before.status === "archived") throw new JourneyError(409, "An archived journey cannot be changed.");
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  let definition: JourneyDefinition | null = null;
  if (input.definition !== undefined) {
    // Runs already inside keep their place by step id, so a live journey is paused before its steps change.
    if (before.status === "live") throw new JourneyError(409, "Pause the journey before changing its steps.");
    const s = sanitizeJourney(input.definition);
    if (!s.ok) throw new JourneyError(422, s.errors[0], { errors: s.errors });
    await verifyReferences(ctx, s.definition);
    definition = s.definition;
    patch.definition = definition;
    patch.trigger_name = definition.trigger.event;
    patch.version = before.version + 1;
  }
  if (typeof input.name === "string") {
    const name = input.name.trim().slice(0, 120);
    if (!name) throw new JourneyError(422, "Give the journey a name.");
    patch.name = name;
  }
  const { error } = await ctx.admin.from("journeys").update(patch).eq("id", id).eq("tenant_id", ctx.tenantId);
  if (error) throw error;
  const changes = diffForLog("journeys", { name: before.name, trigger: before.trigger_name, steps: before.definition.steps.length }, {
    name: (patch.name as string | undefined) ?? before.name,
    trigger: (patch.trigger_name as string | undefined) ?? before.trigger_name,
    steps: definition ? definition.steps.length : before.definition.steps.length,
  });
  if (changes.length) await logChange(ctx.supabase, { tenantId: ctx.tenantId, objectType: "journeys", objectId: id, objectLabel: before.ref ?? before.name, action: "update", actorId: ctx.userId, changes });
  return (await loadJourneyRow(ctx.admin, ctx.tenantId, id)) as LoadedJourney;
}

export type StatusResult = { status: "live" | "paused"; enrolled: number } | { needsConfirm: true; checks: GoLiveCheck[] };

export async function setJourneyStatus(ctx: JourneyCtx, id: string, action: "turn_on" | "pause", confirmed: boolean): Promise<StatusResult> {
  const j = await loadJourneyRow(ctx.admin, ctx.tenantId, id);
  if (!j) throw new JourneyError(404, "Not found");
  if (j.status === "archived") throw new JourneyError(409, "An archived journey cannot be turned on.");
  const now = new Date();

  if (action === "pause") {
    if (j.status !== "live") throw new JourneyError(409, "It is not on.");
    await ctx.admin.from("journeys").update({ status: "paused", updated_at: now.toISOString() }).eq("id", id).eq("tenant_id", ctx.tenantId);
    await logChange(ctx.supabase, { tenantId: ctx.tenantId, objectType: "journeys", objectId: id, objectLabel: j.ref ?? j.name, action: "update", actorId: ctx.userId, changes: [{ field: "status", from: "live", to: "paused" }] });
    return { status: "paused", enrolled: 0 };
  }

  if (j.status === "live") throw new JourneyError(409, "It is already on.");
  if (j.invalid) throw new JourneyError(422, "This journey's steps are not valid. Open it and fix them first.");
  const problems = readinessProblems(j.definition);
  if (problems.length) throw new JourneyError(422, problems[0], { errors: problems });
  await verifyReferences(ctx, j.definition);

  const { checks, needsConfirm } = await goLiveChecks(ctx.admin, ctx.env, j, now);
  if (needsConfirm && !confirmed) return { needsConfirm: true, checks };

  const lookback = j.definition.entry.lookback_days;
  const entryFrom = new Date(now.getTime() - lookback * 86_400_000).toISOString();
  const { error } = await ctx.admin.from("journeys").update({
    status: "live", entry_from: entryFrom, went_live_at: j.went_live_at ?? now.toISOString(), trigger_name: j.definition.trigger.event, updated_at: now.toISOString(),
  }).eq("id", id).eq("tenant_id", ctx.tenantId);
  if (error) throw error;
  const live = (await loadJourneyRow(ctx.admin, ctx.tenantId, id)) as LoadedJourney;
  const enrolled = lookback > 0 ? await backfill(ctx.admin, ctx.env, live, now) : 0;
  await logChange(ctx.supabase, { tenantId: ctx.tenantId, objectType: "journeys", objectId: id, objectLabel: j.ref ?? j.name, action: "update", actorId: ctx.userId, changes: [{ field: "status", from: j.status, to: "live" }] });
  return { status: "live", enrolled };
}

/** A journey that never ran is deleted; one with history is archived, so its run log stays readable. */
export async function removeJourney(ctx: JourneyCtx, id: string): Promise<"deleted" | "archived"> {
  const j = await loadJourneyRow(ctx.admin, ctx.tenantId, id);
  if (!j) throw new JourneyError(404, "Not found");
  const runs = await ctx.admin.from("journey_runs").select("id").eq("tenant_id", ctx.tenantId).eq("journey_id", id).limit(1);
  const hasHistory = !runs.error && (runs.data ?? []).length > 0;
  if (hasHistory || j.status === "live") {
    await ctx.admin.from("journeys").update({ status: "archived", updated_at: new Date().toISOString() }).eq("id", id).eq("tenant_id", ctx.tenantId);
    await logChange(ctx.supabase, { tenantId: ctx.tenantId, objectType: "journeys", objectId: id, objectLabel: j.ref ?? j.name, action: "update", actorId: ctx.userId, changes: [{ field: "status", from: j.status, to: "archived" }] });
    return "archived";
  }
  const { error } = await ctx.admin.from("journeys").delete().eq("id", id).eq("tenant_id", ctx.tenantId);
  if (error) throw error;
  await logChange(ctx.supabase, { tenantId: ctx.tenantId, objectType: "journeys", objectId: id, objectLabel: j.ref ?? j.name, action: "delete", actorId: ctx.userId });
  return "deleted";
}

