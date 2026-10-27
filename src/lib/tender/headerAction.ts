// The ONE primary button in the header of a tender deal follows the stage (redesign, docs/design/gcc-tender-deals.md section 26). PURE.
//
// Before this a tender showed the standard deal's "Convert to Standard Quote", so a tender set to Won produced a quote and not a
// project. A standard deal never calls this: its header is unchanged.

export type TenderPrimaryKey = "propose_decision" | "submit_bid" | "revise_bid" | "record_outcome" | "create_project" | "open_project";
export type TenderPrimary = { key: TenderPrimaryKey; label: string; guide: string };

const BUTTONS: Record<TenderPrimaryKey, TenderPrimary> = {
  propose_decision: { key: "propose_decision", label: "Propose bid decision", guide: "tender.primary.propose" },
  submit_bid: { key: "submit_bid", label: "Submit bid", guide: "tender.primary.submit" },
  revise_bid: { key: "revise_bid", label: "Revise bid", guide: "tender.primary.revise" },
  record_outcome: { key: "record_outcome", label: "Record the outcome", guide: "tender.primary.outcome" },
  create_project: { key: "create_project", label: "Create contract project", guide: "tender.primary.create_project" },
  open_project: { key: "open_project", label: "Open contract project", guide: "tender.primary.open_project" },
};

export const CLOSED_TENDER_STAGES: readonly string[] = ["awarded", "bid_lost", "no_bid"];

export type PrimaryFacts = {
  stage: string;
  /** The deal's outcome: "open", "won", "lost" or "dropped". */
  outcome: string;
  /** Bid versions already submitted. */
  bids: number;
  /** An approved go stands (null when approval is not available yet). */
  approvedGo: boolean | null;
  /** The caller may change the deal (edit access to the Pipeline). */
  canEdit: boolean;
  /** Contract projects: absent when the workspace does not have the module. */
  project: { existing: boolean; canCreate: boolean } | null;
};

/** The primary button for a tender at this point, or null when there is nothing to push (a closed tender that was lost or not bid). */
export function tenderPrimary(f: PrimaryFacts): TenderPrimary | null {
  const closed = f.outcome !== "open" || CLOSED_TENDER_STAGES.includes(f.stage);
  if (closed) {
    if (f.stage === "awarded" && f.outcome === "won" && f.project) {
      if (f.project.existing) return BUTTONS.open_project;
      if (f.project.canCreate) return BUTTONS.create_project;
    }
    return null;
  }
  if (!f.canEdit) return null;
  switch (f.stage) {
    case "received":
      return BUTTONS.propose_decision;
    case "bid_no_bid":
      return f.approvedGo === true ? (f.bids > 0 ? BUTTONS.revise_bid : BUTTONS.submit_bid) : BUTTONS.propose_decision;
    case "estimating":
      return f.bids > 0 ? BUTTONS.revise_bid : BUTTONS.submit_bid;
    case "submitted":
    case "clarifications":
      return BUTTONS.record_outcome;
    default:
      return null;
  }
}
