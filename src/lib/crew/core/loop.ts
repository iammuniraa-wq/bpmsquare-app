// The run loop (docs/design/nova-crew-agents.md section 2), with NO database and NO network of its own: the model, the tools, the
// budget/pause gate and the validator are all handed in. That is what lets the runner (DB-backed), the eval harness (fixture-backed)
// and the unit tests drive exactly the same code.
//
//   model turn(s) [allow-listed READ tools only, <= maxTurns, <= maxToolCalls] -> submit_findings -> validate -> done
//
// The model's one write-shaped tool, submit_findings, writes nothing: its input is validated and only then persisted by the caller.

import type { AgentLimits, JSONSchema, Ref, StepKind, SubmitFindings, ToolResult } from "../types";
import type { ValidatedFinding } from "./grounding";

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };
export type ModelMessage = { role: "user" | "assistant"; content: string | ContentBlock[] };
export type ToolSpec = { name: string; description: string; input_schema: JSONSchema };
export type ModelUsage = { input_tokens?: number | null; output_tokens?: number | null; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null };
export type ModelReply = { content: ContentBlock[]; stopReason: string; usage: ModelUsage; model: string };
export type ModelRequest = { system: string; messages: ModelMessage[]; tools: ToolSpec[]; maxTokens: number };
export interface CrewModel { create(req: ModelRequest): Promise<ModelReply> }

export const SUBMIT_TOOL = "submit_findings";
/** About 6k tokens of JSON per tool result. */
export const TOOL_RESULT_CHARS = 24_000;

// ── Steps (the trace) ─────────────────────────────────────────────────────────────────────────────────────────────────

export type StepRecord = {
  seq: number;
  /** Citable id ("s1") for prefetch and tool steps; null for the rest. */
  id: string | null;
  kind: StepKind;
  name: string;
  input: unknown;
  output: unknown;
  refs: Ref[];
  ok: boolean;
  error: string | null;
  tokens_in: number;
  tokens_out: number;
  ms: number;
};

export class StepLog {
  private seq = 0;
  private cite = 0;
  readonly outputs = new Map<string, unknown>();
  readonly refsByStep = new Map<string, Ref[]>();
  readonly records: StepRecord[] = [];
  constructor(private readonly sink?: (r: StepRecord) => Promise<void>) {}

  async add(s: { kind: StepKind; name: string; input?: unknown; output?: unknown; refs?: Ref[]; ok?: boolean; error?: string | null; tokens_in?: number; tokens_out?: number; ms?: number }): Promise<StepRecord> {
    const citable = s.kind === "prefetch" || s.kind === "tool";
    const rec: StepRecord = {
      seq: ++this.seq, id: citable ? `s${++this.cite}` : null, kind: s.kind, name: s.name, input: s.input ?? null, output: s.output ?? null,
      refs: s.refs ?? [], ok: s.ok ?? true, error: s.error ?? null, tokens_in: s.tokens_in ?? 0, tokens_out: s.tokens_out ?? 0, ms: s.ms ?? 0,
    };
    if (rec.id && rec.ok) { this.outputs.set(rec.id, rec.output); this.refsByStep.set(rec.id, rec.refs); }
    this.records.push(rec);
    if (this.sink) { try { await this.sink(rec); } catch { /* the trace is best effort; the run goes on */ } }
    return rec;
  }
}

// ── The loop ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type GateVerdict = { ok: true } | { ok: false; status: "cancelled" | "skipped_budget"; reason: string };

export type LoopOptions = {
  model: CrewModel;
  system: string;
  user: string;
  tools: ToolSpec[];
  limits: AgentLimits;
  steps: StepLog;
  runTool: (name: string, input: unknown) => Promise<ToolResult>;
  validate: (submit: SubmitFindings) => { accepted: ValidatedFinding[]; rejected: { index: number; reason: string }[] };
  /** Checked before every model call and every tool call (pause takes effect between steps; budget before every call). */
  gate: () => Promise<GateVerdict>;
  /** Called with each reply's usage; returns nothing. The caller keeps the running totals for the budget gate. */
  meter: (usage: ModelUsage, model: string) => Promise<void> | void;
};

export type LoopResult = {
  status: "done" | "cancelled" | "skipped_budget" | "failed";
  reason: string | null;
  accepted: ValidatedFinding[];
  dropped: { reason: string }[];
  nothingToReport: string | null;
  turns: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  model: string | null;
};

const billed = (u: ModelUsage) => {
  const n = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return { input: n(u.input_tokens) + Math.ceil(n(u.cache_creation_input_tokens) * 1.25) + Math.ceil(n(u.cache_read_input_tokens) * 0.1), output: n(u.output_tokens) };
};

function capJson(value: unknown): string {
  let s: string;
  try { s = JSON.stringify(value); } catch { s = "{}"; }
  return s.length > TOOL_RESULT_CHARS ? `${s.slice(0, TOOL_RESULT_CHARS)} ...[cut: result too long, ask for fewer records]` : s;
}

function asSubmit(input: unknown): SubmitFindings | null {
  if (!input || typeof input !== "object") return null;
  const o = input as { findings?: unknown; nothing_to_report?: unknown };
  if (!Array.isArray(o.findings)) return null;
  return { findings: o.findings as SubmitFindings["findings"], nothing_to_report: typeof o.nothing_to_report === "string" ? o.nothing_to_report.slice(0, 240) : undefined };
}

export async function runLoop(o: LoopOptions): Promise<LoopResult> {
  const res: LoopResult = { status: "failed", reason: null, accepted: [], dropped: [], nothingToReport: null, turns: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0, model: null };
  const messages: ModelMessage[] = [{ role: "user", content: o.user }];
  let retried = false;
  let nudged = false;

  for (let turn = 0; turn < o.limits.maxTurns; turn++) {
    const g = await o.gate();
    if (!g.ok) { res.status = g.status; res.reason = g.reason; return res; }

    let reply: ModelReply;
    const t0 = Date.now();
    try {
      reply = await o.model.create({ system: o.system, messages, tools: o.tools, maxTokens: 4096 });
    } catch (e) {
      res.reason = (e as Error).message || "The AI service failed.";
      await o.steps.add({ kind: "model", name: "model call", ok: false, error: res.reason, ms: Date.now() - t0 });
      return res;
    }
    res.turns++;
    res.model = reply.model;
    const t = billed(reply.usage);
    res.inputTokens += t.input;
    res.outputTokens += t.output;
    await o.meter(reply.usage, reply.model);
    await o.steps.add({ kind: "model", name: `turn ${turn + 1}`, tokens_in: t.input, tokens_out: t.output, ms: Date.now() - t0, output: { stop_reason: reply.stopReason } });

    if (reply.stopReason === "refusal" || reply.stopReason === "max_tokens") {
      res.reason = reply.stopReason === "refusal" ? "The AI declined this request." : "The answer was too long to read in one go.";
      return res;
    }

    const uses = reply.content.filter((b): b is Extract<ContentBlock, { type: "tool_use" }> => b.type === "tool_use");
    if (uses.length === 0) {
      if (nudged) { res.reason = "The AI did not return findings."; return res; }
      nudged = true;
      messages.push({ role: "assistant", content: reply.content });
      messages.push({ role: "user", content: `Call ${SUBMIT_TOOL} now with your findings (an empty list and a one-line nothing_to_report if nothing needs attention).` });
      continue;
    }

    messages.push({ role: "assistant", content: reply.content });
    const results: ContentBlock[] = [];
    let finished = false;
    for (const u of uses) {
      if (u.name === SUBMIT_TOOL) {
        const submit = asSubmit(u.input);
        if (!submit) { results.push({ type: "tool_result", tool_use_id: u.id, content: `Error: ${SUBMIT_TOOL} needs a findings array.`, is_error: true }); continue; }
        const v = o.validate(submit);
        await o.steps.add({ kind: "validate", name: "validate findings", output: { submitted: submit.findings.length, accepted: v.accepted.length, rejected: v.rejected } });
        res.accepted.push(...v.accepted);
        if (v.rejected.length > 0 && !retried) {
          retried = true;
          results.push({
            type: "tool_result", tool_use_id: u.id, is_error: true,
            content: `Rejected: ${v.rejected.map((r) => `finding ${r.index + 1}: ${r.reason}`).join("; ")}. The accepted ones are kept. Call ${SUBMIT_TOOL} again with ONLY corrected versions of the rejected findings, or an empty list. Remember: no digits outside {{sN.path}} placeholders.`,
          });
          continue;
        }
        for (const r of v.rejected) res.dropped.push({ reason: r.reason });
        res.nothingToReport = res.accepted.length === 0 ? (submit.nothing_to_report?.trim() || "Nothing needs attention.") : null;
        results.push({ type: "tool_result", tool_use_id: u.id, content: "Received." });
        finished = true;
        continue;
      }

      const gg = await o.gate();
      if (!gg.ok) { res.status = gg.status; res.reason = gg.reason; return res; }
      if (res.toolCalls >= o.limits.maxToolCalls) {
        results.push({ type: "tool_result", tool_use_id: u.id, content: `Error: tool limit reached. Call ${SUBMIT_TOOL} with what you have and list what you could not check in gaps.`, is_error: true });
        continue;
      }
      res.toolCalls++;
      const out = await o.runTool(u.name, u.input);
      results.push({ type: "tool_result", tool_use_id: u.id, content: out.ok ? capJson(out.data) : `Error: ${out.error}`, is_error: !out.ok });
    }
    messages.push({ role: "user", content: results });
    if (finished) { res.status = "done"; return res; }
  }

  res.reason = "The AI used all its turns without returning findings.";
  return res;
}

export function submitToolSpec(findingSchema: JSONSchema): ToolSpec {
  return {
    name: SUBMIT_TOOL,
    description: "Return your findings. Nothing in it is executed; it is checked against the tool results you cited. Write numbers, dates and counts only as {{sN.path}} placeholders pointing into a tool result.",
    input_schema: findingSchema,
  };
}
