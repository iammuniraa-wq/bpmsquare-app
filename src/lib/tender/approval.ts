// GCC tender deals, slice 1b (docs/design/gcc-tender-deals.md section 10): manager approval of the bid / no-bid decision.
// Pure rules, no I/O and no server imports, so the routes, the stage guard, the screens and the tests share one reading of
// "who may decide" and "may this stage change go through". The table is approval_requests (migration 0221); one row per
// proposal, so the rows are also the history.

import type { TenantConfig } from "@/lib/constants";
import type { TenderDecision } from "./rules";

export const APPROVAL_OBJECT_TENDER = "opportunity_tenders";
export const APPROVAL_KIND_TENDER_BID = "tender_bid_decision";

export const APPROVAL_STATUSES = ["pending", "approved", "rejected", "cancelled"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];
export const APPROVAL_STATUS_LABEL: Record<ApprovalStatus, string> = { pending: "Waiting", approved: "Approved", rejected: "Rejected", cancelled: "Withdrawn" };

export type ApprovalRow = {
  id: string;
  requested_by: string;
  proposed_value: TenderDecision;
  reason: string | null;
  status: ApprovalStatus;
  decided_by: string | null;
  decided_at: string | null;
  decision_comment: string | null;
  created_at: string;
};

/** A proposal can be made only while the deal is still deciding whether to bid. Rejection returns it to Bid/No-bid. */
export const PROPOSAL_STAGES: readonly string[] = ["received", "bid_no_bid"];
export const DECISION_STAGE = "bid_no_bid";
/** The stages that mean "we are bidding". Entering one from an earlier stage needs an approved go. */
export const BID_STAGES: readonly string[] = ["estimating", "submitted", "clarifications", "awarded", "bid_lost"];
export const NO_BID_STAGE = "no_bid";

// ── Who may decide ─────────────────────────────────────────────────────────────────────────────────────────────────

export type TenderSettings = { approvers: string[]; allowSelfApproval: boolean };

/** The workspace's tender settings, read defensively from tenants.config (a missing or odd value reads as the defaults). */
export function tenderSettings(config: Pick<TenantConfig, "tender"> | null | undefined): TenderSettings {
  const t = config?.tender;
  const ids = Array.isArray(t?.approvers) ? t.approvers.filter((x): x is string => typeof x === "string" && x.length > 0) : [];
  return { approvers: [...new Set(ids)], allowSelfApproval: t?.allow_self_approval === true };
}

/**
 * The people who may approve a bid decision: the approvers chosen in Settings who are STILL members of the workspace, or,
 * when none is chosen (or none of them is a member any more), every workspace admin. Someone who left never keeps the power.
 */
export function approverIds(settings: TenderSettings, memberIds: readonly string[], adminIds: readonly string[]): string[] {
  const members = new Set(memberIds);
  const chosen = settings.approvers.filter((id) => members.has(id));
  const pool = chosen.length > 0 ? chosen : adminIds.filter((id) => members.has(id));
  return [...new Set(pool)];
}

/** Of those approvers, who may decide THIS proposal: the proposer cannot, unless the workspace allows self-approval. */
export function decidersFor(approvers: readonly string[], proposerId: string, allowSelfApproval: boolean): string[] {
  return approvers.filter((id) => allowSelfApproval || id !== proposerId);
}

export function canDecide(userId: string, approvers: readonly string[], proposerId: string, allowSelfApproval: boolean): boolean {
  return decidersFor(approvers, proposerId, allowSelfApproval).includes(userId);
}

// ── The proposal ───────────────────────────────────────────────────────────────────────────────────────────────────

export type ParsedProposal = { ok: true; decision: TenderDecision; reason: string } | { ok: false; error: string };

/** A proposal is go or no-go WITH a reason (both: the approver reads the reason before deciding). */
export function parseProposal(body: Record<string, unknown>): ParsedProposal {
  const decision = body.decision;
  if (decision !== "go" && decision !== "no_go") return { ok: false, error: "decision must be go or no_go" };
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 1000) : "";
  if (!reason) return { ok: false, error: decision === "go" ? "Give the reason for bidding" : "Give the reason for a no-go" };
  return { ok: true, decision, reason };
}

export type ParsedAction = { ok: true; action: "approve" | "reject" | "cancel"; comment: string | null } | { ok: false; error: string };

/** A decision on a proposal: approve, reject (the comment is required) or withdraw (the proposer's own). */
export function parseAction(body: Record<string, unknown>): ParsedAction {
  const action = body.action;
  if (action !== "approve" && action !== "reject" && action !== "cancel") return { ok: false, error: "action must be approve, reject or cancel" };
  const comment = typeof body.comment === "string" && body.comment.trim() ? body.comment.trim().slice(0, 1000) : null;
  if (action === "reject" && !comment) return { ok: false, error: "Say why you are rejecting it" };
  return { ok: true, action, comment };
}

/** Why a new proposal cannot be made right now, or null. */
export function proposalProblem(args: { stage: string; outcome: string; hasPending: boolean; deciders: readonly string[] }): string | null {
  if (args.outcome !== "open") return "This tender is closed";
  if (!PROPOSAL_STAGES.includes(args.stage)) return "A bid decision is proposed while the tender is in Received or Bid/No-bid. Move it back first if you want to reverse it";
  if (args.hasPending) return "A proposal is already waiting for approval";
  if (args.deciders.length === 0) return "No one else can approve it. Choose approvers in Settings > Tenders, or allow self-approval there";
  return null;
}

// ── The decision that stands ───────────────────────────────────────────────────────────────────────────────────────

/** The latest APPROVED proposal (the decision that stands), or null. A newer approval replaces an older one. */
export function effectiveDecision<T extends Pick<ApprovalRow, "status" | "decided_at" | "created_at">>(rows: readonly T[]): T | null {
  let best: T | null = null;
  for (const r of rows) {
    if (r.status !== "approved") continue;
    const at = Date.parse(r.decided_at ?? r.created_at);
    if (best === null || at > Date.parse(best.decided_at ?? best.created_at)) best = r;
  }
  return best;
}

/**
 * May a tender deal change stage? This is the server-side rule; the form only mirrors it.
 *  - Into No-bid (from any other stage): the standing decision must be an approved no-go.
 *  - From a stage before the bid (Received, Bid/No-bid, No-bid) into the bid stages (Estimating onward): the standing decision
 *    must be an approved go. Moving between bid stages, or back to an earlier stage, asks for nothing.
 * `effective` is null when nothing is approved. Returns the message to show, or null when the move is fine.
 */
export function stageGuard(args: { from: string; to: string; effective: { proposed_value: TenderDecision } | null }): string | null {
  const { from, to, effective } = args;
  if (from === to) return null;
  if (to === NO_BID_STAGE && effective?.proposed_value !== "no_go") {
    return "A no-go needs a manager's approval first. Propose it from Bid decision at the top of the deal";
  }
  if (BID_STAGES.includes(to) && !BID_STAGES.includes(from) && effective?.proposed_value !== "go") {
    return "Bidding needs a manager's approval first. Propose the go decision from Bid decision at the top of the deal";
  }
  return null;
}

/**
 * Where an APPROVED decision takes the deal by itself (redesign step 1): a go from Received or Bid/No-bid to Estimating, a no-go to
 * No-bid (closed, dropped). Null when the deal is not at a deciding stage or is already closed, so a decision approved later in the
 * deal's life (a re-proposal) never drags it backwards. The move itself goes through the deal's own stage route.
 */
export function stageAfterApproval(args: { stage: string; outcome: string; decision: TenderDecision }): string | null {
  if (args.outcome !== "open" || !PROPOSAL_STAGES.includes(args.stage)) return null;
  return args.decision === "go" ? "estimating" : NO_BID_STAGE;
}

// ── What the Tender tab is given ───────────────────────────────────────────────────────────────────────────────────

export type ApprovalEntry = {
  id: string;
  decision: TenderDecision;
  reason: string | null;
  status: ApprovalStatus;
  requested_by_name: string | null;
  requested_at: string;
  decided_by_name: string | null;
  decided_at: string | null;
  comment: string | null;
};

export type ApprovalView = {
  /** The decision that stands: the latest approved proposal. */
  standing: ApprovalEntry | null;
  /** A decision stored in slice 1, before approval existed: shown as such, and it does not unlock a stage. */
  recordedBefore: boolean;
  pending: (ApprovalEntry & { mine: boolean }) | null;
  /** May this person decide the pending proposal? */
  canDecide: boolean;
  /** Why no proposal can be made now (shown in place of the form), or null when one can. */
  proposalBlocked: string | null;
  history: ApprovalEntry[];
};

export const APPROVAL_HISTORY_SHOWN = 10;

// ── Words ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const decisionWord = (d: TenderDecision) => (d === "go" ? "bid (go)" : "no-go");

/** The note the approver receives. Plain text: the reason is a colleague's own words, never HTML. */
export function proposalMessage(args: { title: string; proposer: string; decision: TenderDecision; reason: string; link: string | null }): { subject: string; text: string; comment: string } {
  const subject = `Approval needed: ${decisionWord(args.decision)} for ${args.title}`.slice(0, 200);
  const text = [
    `${args.proposer} proposes ${decisionWord(args.decision)} for the tender "${args.title}".`,
    `Reason: ${args.reason}`,
    args.link ? `Review and decide: ${args.link}` : "",
    "You are receiving this because you can approve bid decisions in this workspace.",
  ].filter(Boolean).join("\n");
  return { subject, text, comment: `Asks you to approve ${decisionWord(args.decision)}: ${args.reason}`.slice(0, 600) };
}

/** The note the proposer receives about the outcome. */
export function outcomeMessage(args: { title: string; decider: string; decision: TenderDecision; approved: boolean; comment: string | null; link: string | null; movedTo?: string | null }): { subject: string; text: string; comment: string } {
  const verdict = args.approved ? "approved" : "rejected";
  const subject = `${args.approved ? "Approved" : "Rejected"}: ${decisionWord(args.decision)} for ${args.title}`.slice(0, 200);
  const text = [
    `${args.decider} ${verdict} your proposal of ${decisionWord(args.decision)} for the tender "${args.title}".`,
    args.comment ? `Comment: ${args.comment}` : "",
    args.approved ? (args.movedTo ? `The deal moved to ${args.movedTo}.` : "") : "The tender is back in Bid/No-bid.",
    args.link ? `Open the deal: ${args.link}` : "",
  ].filter(Boolean).join("\n");
  return { subject, text, comment: `${args.approved ? "Approved" : "Rejected"} ${decisionWord(args.decision)}${args.comment ? `: ${args.comment}` : ""}`.slice(0, 600) };
}
