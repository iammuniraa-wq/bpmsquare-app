import { JUSTIFICATION_NEEDS_NOTE, type RevisionRow } from "./types";

// Baseline approval of a contract project's budget (slice 5a), pure. It reuses the bid / no-bid approval's people and rules
// (src/lib/tender/approval.ts: the approvers chosen in Settings > Tenders, workspace admins by default, and the self-approval
// switch) and the same table, approval_requests, with kind "project_baseline". The proposed value is the revision's id, so one row is
// one request to approve one revision, and the rows are the history. The bid / no-bid code is not touched.

export { tenderSettings, approverIds, decidersFor, canDecide, parseAction } from "@/lib/tender/approval";

export const PROJECT_APPROVAL_OBJECT = "contract_projects";
export const PROJECT_APPROVAL_KIND = "project_baseline";

/** A revision's justification is complete: not needed for the baseline (rev 0); later the reason is chosen, and "Other" needs a note. */
export function justificationProblem(rev: Pick<RevisionRow, "rev_no" | "justification_code" | "justification_text">): string | null {
  if (rev.rev_no === 0) return null;
  if (!rev.justification_code) return "Choose why this revision is being made";
  if (rev.justification_code === JUSTIFICATION_NEEDS_NOTE && !(rev.justification_text ?? "").trim()) return "Say what changed: this reason needs a note";
  return null;
}

/** Why an approval cannot be asked for right now, or null. The same checks run in the route; the screen mirrors them. */
export function askProblem(args: {
  revision: Pick<RevisionRow, "status" | "rev_no" | "justification_code" | "justification_text">;
  lineCount: number;
  linesWithoutResource: number;
  deciders: readonly string[];
  projectClosed: boolean;
}): string | null {
  if (args.projectClosed) return "This project is closed";
  if (args.revision.status === "pending") return "This revision is already waiting for approval";
  if (args.revision.status !== "draft") return "Only a draft revision can be sent for approval";
  if (args.lineCount === 0) return "Add at least one budget line first";
  if (args.linesWithoutResource > 0) return `${args.linesWithoutResource} line${args.linesWithoutResource === 1 ? " has" : "s have"} no resource type. Choose one for each`;
  const j = justificationProblem(args.revision);
  if (j) return j;
  if (args.deciders.length === 0) return "No one else can approve it. Choose approvers in Settings > Tenders, or allow self-approval there";
  return null;
}

/** The text of the request, kept on the approval row (what the approver reads first). */
export function requestReason(rev: Pick<RevisionRow, "rev_no" | "justification_code" | "justification_text">, justificationName: string | null, total: number, currency: string | null): string {
  const money = `${currency ?? ""} ${total.toLocaleString("en-US", { maximumFractionDigits: 2 })}`.trim();
  if (rev.rev_no === 0) return `Baseline budget, ${money}`.slice(0, 1000);
  return [`Revision ${rev.rev_no}, ${money}`, justificationName ?? rev.justification_code, rev.justification_text].filter(Boolean).join(": ").slice(0, 1000);
}

/** The note the approver receives. Plain text: the reason is a colleague's own words, never HTML. */
export function askMessage(args: { project: string; ref: string | null; proposer: string; revNo: number; reason: string; link: string | null }): { subject: string; text: string; comment: string } {
  const what = args.revNo === 0 ? "the baseline budget" : `budget revision ${args.revNo}`;
  const title = `${args.ref ? `${args.ref} ` : ""}${args.project}`.trim();
  const subject = `Approval needed: ${what} for ${title}`.slice(0, 200);
  const text = [
    `${args.proposer} asks you to approve ${what} of the contract project "${title}".`,
    `Request: ${args.reason}`,
    args.link ? `Review and decide: ${args.link}` : "",
    "You are receiving this because you can approve project budgets in this workspace.",
  ].filter(Boolean).join("\n");
  return { subject, text, comment: `Asks you to approve ${what}: ${args.reason}`.slice(0, 600) };
}

/** The note the proposer receives about the outcome. */
export function outcomeMessage(args: { project: string; ref: string | null; decider: string; revNo: number; approved: boolean; comment: string | null; link: string | null }): { subject: string; text: string; comment: string } {
  const what = args.revNo === 0 ? "the baseline budget" : `budget revision ${args.revNo}`;
  const title = `${args.ref ? `${args.ref} ` : ""}${args.project}`.trim();
  const verdict = args.approved ? "approved" : "rejected";
  const subject = `${args.approved ? "Approved" : "Rejected"}: ${what} for ${title}`.slice(0, 200);
  const text = [
    `${args.decider} ${verdict} ${what} of "${title}".`,
    args.comment ? `Comment: ${args.comment}` : "",
    args.approved ? "The budget is now locked. Later changes are a new revision." : "The revision is back in draft; you can change it and ask again.",
    args.link ? `Open the project: ${args.link}` : "",
  ].filter(Boolean).join("\n");
  return { subject, text, comment: `${args.approved ? "Approved" : "Rejected"} ${what}${args.comment ? `: ${args.comment}` : ""}`.slice(0, 600) };
}
