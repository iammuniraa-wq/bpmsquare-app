import { VERDICT_LABEL, type Findings, type Signal, type Verdict } from "./types";

// The award warning for a flagged supplier. Pure and client-safe: the screens, the assistant card and the award routes all ask the same
// questions of the same functions. A supplier whose newest saved check is "Check first" or "Concerning" can still be awarded, but the
// person must say why (and, for "Concerning", confirm they read the findings). It never blocks and it never changes the verdict.

export const GATE_MIN_REASON = 5;
export const GATE_MAX_REASON = 1000;
export const FLAGGED_VERDICTS: readonly Verdict[] = ["check_first", "concerning"];

export type AwardCheck = { supplierId: string; name: string; verdict: Verdict; findings: string[]; checkedAt: string };

export const isFlaggedVerdict = (v: Verdict | null | undefined): boolean => v === "check_first" || v === "concerning";

export const flaggedOf = (checks: readonly AwardCheck[]): AwardCheck[] => checks.filter((c) => isFlaggedVerdict(c.verdict));

const RANK: Record<Signal["severity"], number> = { high: 3, medium: 2, low: 1, info: 0 };

/** The strongest findings of a saved check as plain sentences, at most `n`; informational lines are not warnings. */
export function topFindings(findings: Partial<Findings> | null | undefined, n = 2): string[] {
  const signals = Array.isArray(findings?.signals) ? (findings!.signals as Signal[]) : [];
  return signals
    .filter((s) => s && typeof s.text === "string" && s.text.trim() && (RANK[s.severity] ?? 0) > 0)
    .map((s, i) => ({ s, i }))
    .sort((a, b) => (RANK[b.s.severity] ?? 0) - (RANK[a.s.severity] ?? 0) || a.i - b.i)
    .slice(0, n)
    .map(({ s }) => s.text.replace(/\s+/g, " ").trim().replace(/[.\s]+$/, ""));
}

export const cleanGateReason = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim().slice(0, GATE_MAX_REASON);
  return t.length >= GATE_MIN_REASON ? t : null;
};

export type GateInput = { reason?: unknown; ack?: unknown };
export type GateResult =
  | { ok: true; reason: string | null }
  | { ok: false; code: "supplier_check_reason" | "supplier_check_ack"; message: string; suppliers: string[] };

const names = (xs: readonly AwardCheck[]): string => xs.map((x) => x.name).join(", ");

/** Nothing flagged: allowed, no reason carried. Flagged: a reason of at least 5 characters, and for "Concerning" the tick. */
export function evaluateGate(checks: readonly AwardCheck[], input: GateInput): GateResult {
  const flagged = flaggedOf(checks);
  if (!flagged.length) return { ok: true, reason: null };
  const reason = cleanGateReason(input.reason);
  if (!reason) {
    return {
      ok: false, code: "supplier_check_reason", suppliers: flagged.map((f) => f.supplierId),
      message: `${names(flagged)} ${flagged.length === 1 ? "is" : "are"} marked ${[...new Set(flagged.map((f) => VERDICT_LABEL[f.verdict]))].join(" / ")} in your Supplier check. Say why you are awarding anyway (at least ${GATE_MIN_REASON} characters).`,
    };
  }
  const concerning = flagged.filter((f) => f.verdict === "concerning");
  if (concerning.length && input.ack !== true) {
    return {
      ok: false, code: "supplier_check_ack", suppliers: concerning.map((f) => f.supplierId),
      message: `${names(concerning)} ${concerning.length === 1 ? "is" : "are"} marked Concerning in your Supplier check. Confirm that you have reviewed the findings.`,
    };
  }
  return { ok: true, reason };
}

/** What the screen needs before it enables the button. The server asks the same question again. */
export const gateReady = (checks: readonly AwardCheck[], reason: string, ack: boolean): boolean => evaluateGate(checks, { reason, ack }).ok;

export const needsAck = (checks: readonly AwardCheck[]): boolean => checks.some((c) => c.verdict === "concerning");

/** The line the change history keeps for an award made on a flagged supplier. */
export const gateNote = (check: AwardCheck, reason: string): string => `Awarded despite Supplier check: ${VERDICT_LABEL[check.verdict].toLowerCase()}. Reason: ${reason}`;

export const gateBody = (reason: string, ack: boolean, flagged: boolean): { supplier_check_reason?: string; supplier_check_ack?: true } =>
  flagged ? { supplier_check_reason: reason.trim(), ...(ack ? { supplier_check_ack: true as const } : {}) } : {};
