import "server-only";
import { askStructuredMetered, AiError } from "@/lib/ai/structured";
import { getCapabilityCatalog, catalogById } from "@/lib/capability/catalog";
import { sliceForArea } from "@/lib/capability/slice";
import facts from "@/lib/capability/facts.generated.json";
import { CONNECTOR_CATALOG } from "@/lib/connectors/registry";
import {
  SYSTEM_PROMPT, chatSchema, buildChatPrompt, normaliseChat, mapSchema, buildMapPrompt, normaliseMap,
  fitSchema, buildFitPrompt, normaliseFit, changesSchema, buildChangesPrompt, normaliseChanges,
  planSchema, buildPlanPrompt, type ChatTurn, type FitStepInput,
} from "./ai";
import { resolveBudget, resolveMaxMessages, messageAllowed, MESSAGE_CAP_TEXT } from "./caps";
import { templateTasks, normaliseExtraTasks, firstWorkingDay, type PlanContext } from "./plan";
import { needsChange } from "./ratings";
import {
  advance, deleteRows, insertRows, snapshotVersion, updateStudy, type StudioCtx,
} from "./server";
import { AREA_IDS, type AreaId, type ChangeRow, type FitRow, type MessageRow, type StepRow, type StudyRow, type TaskRow } from "./types";

// The orchestration of the studio's AI steps (docs/process-design-studio-architecture.md
// section 6): read the stored rows, ask the model for a schema-shaped proposal,
// run it through the pure normalisers in ai.ts, and write only what survives.
// The model never writes anything itself; this file does, with the service-role
// client, after the route has proved the caller owns the study.

const hand = (study: StudyRow): boolean => ["submitted", "reviewed", "accepted", "rescoped", "closed"].includes(study.status);

function call(ctx: StudioCtx, studyId: string, a: { prompt: string; schema: Record<string, unknown>; effort?: "low" | "medium"; maxTokens?: number }) {
  return askStructuredMetered({
    tenantId: ctx.tenantId, userId: ctx.userId, surface: "process_studio", studyId,
    budget: resolveBudget(ctx.config.process_studio),
    system: SYSTEM_PROMPT, ...a,
  });
}

async function loadMessages(ctx: StudioCtx, studyId: string): Promise<MessageRow[]> {
  const { data } = await ctx.supabase.from("process_study_messages")
    .select("id, role, area, text, understood, questions, created_at")
    .eq("tenant_id", ctx.tenantId).eq("study_id", studyId).order("created_at").order("id").limit(500);
  return (data ?? []) as MessageRow[];
}

async function loadSteps(ctx: StudioCtx, studyId: string): Promise<StepRow[]> {
  const { data } = await ctx.supabase.from("process_study_steps")
    .select("id, area, lane, sort_order, name, what, how_today, frequency, assumed, hands_over")
    .eq("tenant_id", ctx.tenantId).eq("study_id", studyId).order("sort_order").order("id").limit(500);
  return (data ?? []) as StepRow[];
}

async function loadFit(ctx: StudioCtx, studyId: string): Promise<FitRow[]> {
  const { data } = await ctx.supabase.from("process_study_fit")
    .select("id, step_id, rating, capability_ids, why, confidence, warnings, reviewed")
    .eq("tenant_id", ctx.tenantId).eq("study_id", studyId).limit(1000);
  return (data ?? []) as FitRow[];
}

const turnsOf = (messages: readonly MessageRow[]): ChatTurn[] => messages.map((m) => ({ role: m.role, text: m.text, area: m.area }));

// ── Step 1 ───────────────────────────────────────────────────────────────────

export async function runChat(ctx: StudioCtx, study: StudyRow, text: string, area: AreaId | null): Promise<{ client: MessageRow; studio: MessageRow }> {
  const existing = await loadMessages(ctx, study.id);
  const sent = existing.filter((m) => m.role === "client").length;
  if (!messageAllowed(sent, resolveMaxMessages(ctx.config.process_studio))) throw { status: 409, message: MESSAGE_CAP_TEXT };

  const [clientRow] = await insertRows(ctx, "process_study_messages", study.id, [{ role: "client", text, area }]);
  const client = clientRow as unknown as MessageRow;

  const turns: ChatTurn[] = [...turnsOf(existing), { role: "client", text, area }];
  const raw = await call(ctx, study.id, { prompt: buildChatPrompt(turns, study.follow_ups), schema: chatSchema(), effort: "low", maxTokens: 1500 });
  const reply = normaliseChat(raw, study.follow_ups);
  const [studioRow] = await insertRows(ctx, "process_study_messages", study.id, [
    { role: "studio", text: reply.reply, understood: reply.understood, questions: reply.questions },
  ]);
  await updateStudy(ctx, study.id, {});
  return { client, studio: studioRow as unknown as MessageRow };
}

// ── Step 2 ───────────────────────────────────────────────────────────────────

export const CONFIRM_REBUILD = "Building the map again replaces the steps you have edited and clears the fit report, changes and plan. Press again to confirm.";

export async function runBuildMap(ctx: StudioCtx, study: StudyRow, confirm: boolean): Promise<{ steps: number; warnings: string[] }> {
  const messages = await loadMessages(ctx, study.id);
  if (!messages.some((m) => m.role === "client")) throw { status: 422, message: "Tell us a little about how you work first." };
  const existing = await loadSteps(ctx, study.id);
  if (existing.length > 0 && !confirm) throw { status: 409, message: CONFIRM_REBUILD, confirm: true };

  const raw = await call(ctx, study.id, { prompt: buildMapPrompt(turnsOf(messages)), schema: mapSchema(), maxTokens: 9000 });
  const map = normaliseMap(raw);
  const off = new Set(Object.entries(study.areas).filter(([, v]) => v?.off).map(([k]) => k));
  const steps = map.steps.filter((s) => !off.has(s.area));
  if (steps.length === 0) throw { status: 422, message: "We could not find steps in what you wrote yet. Add a little more detail about how a job goes from first call to getting paid, then try again." };

  // Replace everything built on the old map. Comments go with the plan.
  await deleteRows(ctx, "process_study_comments", study.id);
  await deleteRows(ctx, "process_study_tasks", study.id);
  await deleteRows(ctx, "process_study_changes", study.id);
  await deleteRows(ctx, "process_study_fit", study.id);
  await deleteRows(ctx, "process_study_steps", study.id);
  await insertRows(ctx, "process_study_steps", study.id, steps.map((s, i) => ({ ...s, sort_order: i * 10 })));
  await updateStudy(ctx, study.id, { summary: map.summary || null, noticed: [], ...(hand(study) ? {} : { status: "mapped" }), reached: 2 });
  return { steps: steps.length, warnings: map.warnings };
}

// ── Step 3 ───────────────────────────────────────────────────────────────────

export async function runFit(ctx: StudioCtx, study: StudyRow): Promise<{ rows: number; warnings: string[] }> {
  const steps = await loadSteps(ctx, study.id);
  if (steps.length === 0) throw { status: 422, message: "Build the process map first." };
  const previous = await loadFit(ctx, study.id);
  // The old result is kept as a version before it is replaced.
  if (previous.length > 0) await snapshotVersion(ctx, study, "re-run");

  const catalog = getCapabilityCatalog();
  const byId = catalogById(catalog);
  const warnings: string[] = [];
  const noticed: string[] = [];
  const rows: Record<string, unknown>[] = [];

  const areas = AREA_IDS.filter((a) => steps.some((s) => s.area === a));
  const settled = await Promise.allSettled(areas.map(async (area) => {
    const mine = steps.filter((s) => s.area === area);
    const keyToStepId = new Map(mine.map((s, i) => [`s${i + 1}`, s.id] as const));
    const inputs: FitStepInput[] = mine.map((s, i) => ({ key: `s${i + 1}`, name: s.name, what: s.what, how_today: s.how_today, lane: s.lane }));
    const slice = sliceForArea(catalog, area);
    const allowed = new Set(slice.map((e) => e.id));
    const raw = await call(ctx, study.id, {
      prompt: buildFitPrompt(area, inputs, slice, study.summary),
      schema: fitSchema([...keyToStepId.keys()], [...allowed]),
      maxTokens: 8000,
    });
    return normaliseFit(raw, keyToStepId, byId, allowed);
  }));

  const failed: AreaId[] = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") {
      for (const x of r.value.rows) {
        rows.push({ step_id: x.step_id, rating: x.rating, capability_ids: x.capability_ids, why: x.why, confidence: x.confidence, warnings: x.warnings });
      }
      noticed.push(...r.value.noticed);
      warnings.push(...r.value.warnings);
    } else {
      failed.push(areas[i]);
      // Rows for a failed area are Needs review, never silently missing or fine.
      for (const s of steps.filter((x) => x.area === areas[i])) {
        rows.push({ step_id: s.id, rating: "needs_review", capability_ids: [], why: "", confidence: "check_with_us", warnings: ["The check for this area did not finish. Press Check again."] });
      }
    }
  });
  if (failed.length === areas.length) {
    const first = settled.find((r): r is PromiseRejectedResult => r.status === "rejected");
    throw first?.reason ?? new AiError("The check did not finish.", 502);
  }

  await deleteRows(ctx, "process_study_fit", study.id);
  await insertRows(ctx, "process_study_fit", study.id, rows);
  await updateStudy(ctx, study.id, { noticed: [...new Set(noticed)].slice(0, 10) });
  await advance(ctx, study, "fit_ready", 3);
  return { rows: rows.length, warnings };
}

// ── Step 4 ───────────────────────────────────────────────────────────────────

export async function runChanges(ctx: StudioCtx, study: StudyRow): Promise<{ changes: number; warnings: string[] }> {
  const [steps, fit] = await Promise.all([loadSteps(ctx, study.id), loadFit(ctx, study.id)]);
  if (fit.length === 0) throw { status: 422, message: "Check the fit first." };
  const stepById = new Map(steps.map((s) => [s.id, s]));
  const gaps = fit.filter((f) => needsChange(f.rating) && stepById.has(f.step_id));
  const keyToStepId = new Map(gaps.map((f, i) => [`c${i + 1}`, f.step_id] as const));

  const hooks = (facts.extensionHooks as { name: string; doc: string }[]);
  const connectors = CONNECTOR_CATALOG.map((c) => ({ id: c.id, name: c.name }));
  const known = { hooks: new Set(hooks.map((h) => h.name)), connectors: new Set(connectors.map((c) => c.id)) };

  let drafts: ReturnType<typeof normaliseChanges> = { changes: [], warnings: [] };
  if (gaps.length > 0) {
    const raw = await call(ctx, study.id, {
      prompt: buildChangesPrompt(
        gaps.map((f, i) => {
          const s = stepById.get(f.step_id)!;
          return { key: `c${i + 1}`, name: s.name, rating: f.rating, why: f.why, area: s.area };
        }),
        hooks, connectors,
      ),
      schema: changesSchema([...keyToStepId.keys()], hooks.map((h) => h.name), connectors.map((c) => c.id)),
      maxTokens: 8000,
    });
    drafts = normaliseChanges(raw, keyToStepId, known);
  }

  // The client's own additions stay; everything proposed is replaced.
  const { error } = await ctx.admin.from("process_study_changes").delete()
    .eq("tenant_id", ctx.tenantId).eq("study_id", study.id).eq("client_added", false);
  if (error) throw { status: 500, message: error.message };
  await insertRows(ctx, "process_study_changes", study.id, drafts.changes.map((c, i) => ({ ...c, sort_order: i * 10 })));
  await advance(ctx, study, "changes_ready", 4);
  return { changes: drafts.changes.length, warnings: drafts.warnings };
}

// ── Step 5 ───────────────────────────────────────────────────────────────────

export const CONFIRM_PLAN = "Building the plan again replaces the tasks and ticks you have changed. Tasks you added yourself stay. Press again to confirm.";

export async function runPlan(ctx: StudioCtx, study: StudyRow, confirm: boolean): Promise<{ tasks: number; warnings: string[] }> {
  const [steps, fit] = await Promise.all([loadSteps(ctx, study.id), loadFit(ctx, study.id)]);
  if (fit.length === 0) throw { status: 422, message: "Check the fit first." };
  const { data: existingTasks } = await ctx.supabase.from("process_study_tasks")
    .select("id, client_added, from_template").eq("tenant_id", ctx.tenantId).eq("study_id", study.id).limit(1000);
  if ((existingTasks ?? []).length > 0 && !confirm) throw { status: 409, message: CONFIRM_PLAN, confirm: true };

  const { data: changeRows } = await ctx.supabase.from("process_study_changes")
    .select("id, kind, title, effort_band, kept").eq("tenant_id", ctx.tenantId).eq("study_id", study.id).limit(500);
  const kept = ((changeRows ?? []) as Pick<ChangeRow, "id" | "kind" | "title" | "effort_band" | "kept">[]).filter((c) => c.kept);

  const byId = catalogById();
  const modules = new Set<string>();
  for (const f of fit) {
    if (f.rating === "not_covered" || f.rating === "needs_review" || f.rating === "coming") continue;
    for (const id of f.capability_ids) { const m = byId.get(id)?.module; if (m) modules.add(m); }
  }
  const ctxPlan: PlanContext = { modules, areas: new Set(steps.map((s) => s.area)), changes: kept };
  const base = templateTasks(ctxPlan);

  let extras: ReturnType<typeof normaliseExtraTasks> = { tasks: [], warnings: [] };
  const warnings: string[] = [];
  try {
    const raw = await call(ctx, study.id, {
      prompt: buildPlanPrompt(study.summary, base, kept, steps),
      schema: planSchema(), effort: "low", maxTokens: 3000,
    });
    extras = normaliseExtraTasks((raw as { tasks?: unknown } | null)?.tasks, base);
  } catch (e) {
    // The rule-built plan stands on its own; only the client-specific additions are lost.
    if ((e as AiError).code === "over_budget") warnings.push("The AI allowance is used up, so client-specific tasks were not added.");
    else warnings.push("Client-specific tasks could not be suggested this time; the standard plan is complete without them.");
  }
  warnings.push(...extras.warnings);

  const all = [...base, ...extras.tasks];
  await ctx.admin.from("process_study_comments").delete().eq("tenant_id", ctx.tenantId).eq("study_id", study.id).not("phase_ok", "is", null);
  const { error } = await ctx.admin.from("process_study_tasks").delete()
    .eq("tenant_id", ctx.tenantId).eq("study_id", study.id).eq("client_added", false);
  if (error) throw { status: 500, message: error.message };
  await insertRows(ctx, "process_study_tasks", study.id, all.map((t, i) => ({ ...t, sort_order: i * 10 })));

  const patch: Record<string, unknown> = {};
  if (!study.plan_start_date) {
    const d = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    patch.plan_start_date = firstWorkingDay(d, study.weekend);
  }
  await advance(ctx, study, "plan_ready", 5, patch);
  return { tasks: all.length, warnings };
}

export type { TaskRow };
