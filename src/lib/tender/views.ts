// What the Pipeline screens are given for a tender (built on the server, serialised to the client). Client-safe: types only.
// No decision reason, no decided-by, no source e-mail and no reminder log: the board does not need them.

import type { OpportunityRow } from "@/lib/sales/opportunityServer";
import type { TenderDecision, TenderPortal } from "./rules";

export type TenderSummary = {
  tender_no: string | null;
  issuer_name: string | null;
  portal: TenderPortal | null;
  closing_at: string | null;
  decision: TenderDecision | null;
};

export type TenderBoardRow = OpportunityRow & { tender: TenderSummary };

/** The whole tender block of one deal, for its Tender tab. */
export type TenderView = {
  tender_no: string | null;
  issuer_name: string | null;
  issuer_account_id: string | null;
  portal: TenderPortal | null;
  closing_at: string | null;
  bid_bond_amount: number | null;
  bid_bond_currency: string | null;
  bid_bond_expiry: string | null;
  addenda_count: number;
  decision: TenderDecision | null;
  decision_reason: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  source_email_id: string | null;
};
