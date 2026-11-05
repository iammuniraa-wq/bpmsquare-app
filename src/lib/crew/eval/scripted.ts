import { SUBMIT_TOOL, type ContentBlock, type CrewModel, type ModelReply, type ModelRequest } from "../core/loop";
import type { SubmitFindings } from "../types";
import type { EvalCaseFile } from "./harness";

// Deterministic stand-ins for the model, so the loop, the validator and the scoring are tested without a key or a network:
//  - oracleModel(case): submits the case's hand-written correct answer straight away (proves the case is satisfiable);
//  - scriptedModel(replies): plays a fixed list of replies, one per call (a tool call first, a hostile or malformed answer, a retry, ...).

const usage = { input_tokens: 1000, output_tokens: 200 };
let n = 0;
const id = () => `toolu_${++n}`;

export const submitReply = (submit: SubmitFindings): ModelReply => ({ content: [{ type: "tool_use", id: id(), name: SUBMIT_TOOL, input: submit }], stopReason: "tool_use", usage, model: "scripted" });
export const toolReply = (name: string, input: unknown): ModelReply => ({ content: [{ type: "tool_use", id: id(), name, input }], stopReason: "tool_use", usage, model: "scripted" });
export const textReply = (text: string): ModelReply => ({ content: [{ type: "text", text } as ContentBlock], stopReason: "end_turn", usage, model: "scripted" });

export function scriptedModel(replies: readonly ModelReply[]): CrewModel & { calls: ModelRequest[] } {
  let i = 0;
  const calls: ModelRequest[] = [];
  return {
    calls,
    async create(req) {
      calls.push({ ...req, messages: [...req.messages] }); // a snapshot: the loop keeps appending to the live array
      const r = replies[Math.min(i, replies.length - 1)];
      i++;
      return r;
    },
  };
}

export const oracleModel = (c: EvalCaseFile) => scriptedModel([submitReply(c.oracle ?? { findings: [], nothing_to_report: "Nothing needs attention." })]);
