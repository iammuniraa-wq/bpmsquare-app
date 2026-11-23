import { REPORT_PARTS, type ReportPartId } from "./types";

// The lines POST /api/ai/report/run writes, and how the dock reads them. Pure and client-safe: a line is parsed into one of three
// events or dropped, a half line waits for the rest, and a stream that ends without a final line is said plainly.

export type BriefPartState = "running" | "done" | "missing";

export type BriefStreamEvent =
  | { type: "part"; part: ReportPartId; state: BriefPartState }
  | { type: "done"; answer: string; companyReport?: unknown; consent?: unknown }
  | { type: "error"; message: string };

export function parseBriefLine(line: string): BriefStreamEvent | null {
  let o: Record<string, unknown>;
  try { o = JSON.parse(line); } catch { return null; }
  if (!o || typeof o !== "object") return null;
  if (o.type === "part") {
    const state = o.state === "running" || o.state === "done" || o.state === "missing" ? o.state : null;
    return typeof o.part === "string" && (REPORT_PARTS as readonly string[]).includes(o.part) && state ? { type: "part", part: o.part as ReportPartId, state } : null;
  }
  if (o.type === "done") return { type: "done", answer: typeof o.answer === "string" ? o.answer : "", ...(o.companyReport ? { companyReport: o.companyReport } : {}), ...(o.consent ? { consent: o.consent } : {}) };
  if (o.type === "error") return { type: "error", message: typeof o.message === "string" && o.message ? o.message : "Something went wrong." };
  return null;
}

/** Adds a chunk to what was left over and returns the whole lines in it and the rest. */
export function splitBriefChunk(carry: string, chunk: string): { lines: string[]; rest: string } {
  const parts = (carry + chunk).split("\n");
  const rest = parts.pop() ?? "";
  return { lines: parts.filter((l) => l.trim() !== ""), rest };
}

export const STREAM_ENDED_EARLY = "The brief stopped before it finished. Whatever was done is saved: open the company again in a minute.";
