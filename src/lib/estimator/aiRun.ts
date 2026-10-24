// The two email-reading steps with the model passed in, so they can be tested with a
// mocked model and a fake database (no SDK, no "server-only" here). The routes
// (api/estimates/ai/pick and /intake) supply the real metered model call.
//
// Isolation: every read is `.eq("tenant_id", tenantId)` with the tenant from the signed-in
// session, never from the request body. The template id in a request is only ever looked
// up WITH that tenant, so another workspace's template id finds nothing (404).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { EstimateTemplate } from "@/lib/types";
import { MAX_BRIEF_CHARS } from "./ai";
import type { IntakeProposal } from "./ai";
import { buildIntakePromptV2, clampIntakeV2, intakeSchemaV2 } from "./aiIntake";
import type { AskBlock } from "./intakeFiles/convert";
import { fileReports, type FileReport, type LoadedFiles } from "./intakeFiles/load";
import { buildPickPrompt, clampPick, pickSchema, toCandidate } from "./pick";
import type { PickCandidate, PickResult } from "./pick";

/** The model call. `extra` is the attached files' content blocks, sent before the prompt; text-only callers pass none. */
export type Ask = (prompt: string, schema: Record<string, unknown>, extra?: AskBlock[]) => Promise<unknown>;

export type RunFailure = { ok: false; status: number; error: string };

const missingColumn = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === "42703" || e.code === "PGRST204" || /does not exist|schema cache/i.test(e.message ?? ""));

/** Why the text cannot be read, or null when it can. */
export function textProblem(text: unknown): string | null {
  const t = typeof text === "string" ? text.trim() : "";
  if (!t) return "Paste the email first.";
  if (t.length > MAX_BRIEF_CHARS) return `That is too long to read (limit ${MAX_BRIEF_CHARS.toLocaleString("en-GB")} characters). Paste the relevant part.`;
  return null;
}

/** The workspace's active templates as the pick sees them. `keywords` is read when the column exists (0213). */
export async function loadCandidates(supabase: SupabaseClient, tenantId: string): Promise<PickCandidate[] | "pending"> {
  const run = (cols: string) => supabase.from("estimate_templates").select(cols).eq("tenant_id", tenantId).eq("is_active", true).order("name");
  let { data, error } = await run("id, name, description, keywords, inputs");
  if (error && missingColumn(error)) ({ data, error } = await run("id, name, description, inputs"));
  if (error) return "pending";
  return ((data ?? []) as unknown as Parameters<typeof toCandidate>[0][]).map(toCandidate);
}

export async function runPick(d: { supabase: SupabaseClient; tenantId: string; text: string; ask: Ask }): Promise<{ ok: true; result: PickResult; templates: number } | RunFailure> {
  const problem = textProblem(d.text);
  if (problem) return { ok: false, status: 400, error: problem };
  const candidates = await loadCandidates(d.supabase, d.tenantId);
  if (candidates === "pending") return { ok: false, status: 503, error: "Estimates are waiting for a database update." };
  if (candidates.length === 0) return { ok: false, status: 422, error: "There is no estimate template to choose from yet." };
  // One template is no choice: say so without a model call.
  if (candidates.length === 1) {
    const only = candidates[0];
    return { ok: true, templates: 1, result: { template_id: only.id, name: only.name, confidence: 1, level: "high", alternatives: [], not_sure: false, reason: null } };
  }
  const raw = await d.ask(buildPickPrompt(candidates, d.text.trim()), pickSchema(candidates.map((c) => c.id)));
  return { ok: true, templates: candidates.length, result: clampPick(candidates, raw) };
}

/** The reading plus, when files were ticked, what happened to each one. */
export type IntakeResult = IntakeProposal & { files?: FileReport[] };

export async function runIntake(d: {
  supabase: SupabaseClient; tenantId: string; templateId: string; text: string; ask: Ask;
  /** The attachments already loaded and converted (intakeFiles/load.ts). Absent = the email text alone. */
  files?: LoadedFiles;
}): Promise<{ ok: true; proposal: IntakeResult } | RunFailure> {
  const problem = textProblem(d.text);
  if (problem) return { ok: false, status: 400, error: problem };
  const { data, error } = await d.supabase.from("estimate_templates").select("*").eq("id", d.templateId).eq("tenant_id", d.tenantId).maybeSingle();
  if (error) return { ok: false, status: 503, error: "Estimates are waiting for a database update." };
  const tpl = data as EstimateTemplate | null;
  if (!tpl) return { ok: false, status: 404, error: "Template not found" };
  const inputs = tpl.inputs ?? [];
  if (inputs.length === 0) return { ok: false, status: 422, error: "This template has no inputs to fill in." };
  const text = d.text.trim();
  const read = d.files?.files ?? [];
  const skipped = d.files?.skipped ?? [];
  if (read.length === 0) {
    const raw = await d.ask(buildIntakePromptV2(tpl.name, inputs, text), intakeSchemaV2(inputs));
    const proposal: IntakeResult = clampIntakeV2(inputs, raw, text);
    if (skipped.length > 0) {
      proposal.assumptions = [...proposal.assumptions, ...skipped.map((s) => `${s.name} was not read: ${s.reason}`)];
      proposal.files = fileReports({ files: [], skipped });
    }
    return { ok: true, proposal };
  }
  const promptFiles = read.map((f) => ({ name: f.name, kind: f.kind, text: f.text }));
  const raw = await d.ask(buildIntakePromptV2(tpl.name, inputs, text, promptFiles), intakeSchemaV2(inputs), read.flatMap((f) => f.blocks));
  const proposal: IntakeResult = clampIntakeV2(inputs, raw, text, promptFiles);
  proposal.assumptions = [...proposal.assumptions, ...skipped.map((s) => `${s.name} was not read: ${s.reason}`)];
  proposal.files = fileReports({ files: read, skipped });
  return { ok: true, proposal };
}
