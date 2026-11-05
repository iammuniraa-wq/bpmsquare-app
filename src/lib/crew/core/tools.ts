// The tool host: turns a list of allow-listed adapters into the `runTool` the loop calls. It is the single place that enforces the
// adapter rules of docs/design/nova-crew-agents.md section 3.4: the tenant is never an argument, ids the model passes must be in the
// run's candidate set (a foreign id is a tool error, not data), every call is a recorded step with a citable id.

import type { RunContext, ToolAdapter, ToolKey, ToolResult } from "../types";
import type { StepLog, ToolSpec } from "./loop";

const ID_ARGS = ["deal_id", "site_id", "alias"] as const;
const ID_LIST_ARGS = ["deal_ids"] as const;

/** Ids in the model's arguments that are not in the candidate set. */
export function foreignIds(args: unknown, candidates: ReadonlySet<string>): string[] {
  if (!args || typeof args !== "object") return [];
  const a = args as Record<string, unknown>;
  const bad: string[] = [];
  for (const k of ID_ARGS) if (a[k] !== undefined && (typeof a[k] !== "string" || !candidates.has(a[k] as string))) bad.push(String(a[k]).slice(0, 40));
  for (const k of ID_LIST_ARGS) {
    const v = a[k];
    if (v === undefined) continue;
    if (!Array.isArray(v)) { bad.push(k); continue; }
    for (const id of v) if (typeof id !== "string" || !candidates.has(id)) bad.push(String(id).slice(0, 40));
  }
  return bad;
}

export function toolSpecs(adapters: readonly ToolAdapter[]): ToolSpec[] {
  return adapters.map((a) => ({ name: a.key, description: a.description, input_schema: a.inputSchema }));
}

export function makeToolRunner(adapters: readonly ToolAdapter[], allowed: readonly ToolKey[], ctx: RunContext, steps: StepLog) {
  const byKey = new Map(adapters.map((a) => [a.key as string, a]));
  return async function runTool(name: string, input: unknown): Promise<ToolResult> {
    const t0 = Date.now();
    const adapter = byKey.get(name);
    const fail = async (error: string): Promise<ToolResult> => {
      await steps.add({ kind: "tool", name, input, ok: false, error, ms: Date.now() - t0 });
      return { ok: false, error };
    };
    if (!adapter || !allowed.includes(adapter.key)) return fail("That tool is not available.");
    const bad = foreignIds(input, ctx.candidateIds);
    if (bad.length > 0) return fail("That id is not one of this run's candidates.");
    let out: ToolResult;
    try {
      out = await adapter.run(ctx, (input ?? {}) as Record<string, unknown>);
    } catch (e) {
      console.error(`[crew] tool ${name} failed`, (e as Error).message);
      return fail("The tool could not be read.");
    }
    if (!out.ok) return fail(out.error);
    const rec = await steps.add({ kind: "tool", name, input, output: out.data, refs: out.refs ?? [], ms: Date.now() - t0 });
    return { ok: true, data: { _step: rec.id, ...out.data }, refs: out.refs };
  };
}
