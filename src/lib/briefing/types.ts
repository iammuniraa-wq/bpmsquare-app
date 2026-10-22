// The daily briefing (docs/design/assistant-smarter.md section 4). Client-safe: the tile and the dock card import these
// types, the server builds them. Nothing here carries a record's field values: labels, counts, reasons and links only.

export type BriefingItem = { label: string; href: string };

export type BriefingLine = {
  id: string;
  label: string;
  href: string;
  /** The object family the line is about (a change_log / route key), for grouping and tests. */
  objectType: string;
  count?: number;
  /** A few named records behind a grouped line ("top 5 records named"). */
  items?: BriefingItem[];
};

/** How a focus score was reached, so the number can be explained and re-computed by hand. */
export type ScoreWorking = {
  urgency: number;
  urgencyWhy: string;
  valueFactor: number;
  ownership: number;
  ownershipWhy: "yours" | "waiting for your decision";
};

export type FocusLine = BriefingLine & { score: number; why: string; working: ScoreWorking };

export type Briefing = {
  /** The workspace-local calendar day this briefing is for (YYYY-MM-DD). */
  day: string;
  timeZone: string;
  yesterday: BriefingLine[];
  today: BriefingLine[];
  focus: FocusLine[];
  /** The optional AI paragraph (WP8), made only from the facts above and checked against them. Absent: the list stands alone. */
  wording?: { paragraph: string; lang: string; facts: string } | null;
  computedAt: string;
  /** Nothing yesterday and nothing open: the new-user state. */
  empty: boolean;
  /** Read from the stored row rather than worked out just now. */
  cached: boolean;
  /** False while the storage table is not applied: the briefing is worked out on each open. */
  stored: boolean;
  /** Earliest time Refresh will recompute; null when it may be pressed now. */
  refreshableAt: string | null;
};

/** What the briefing rules look at: one thing that wants the person's attention today. */
export type CandidateKind =
  | "quote_expired" | "quote_expiring" | "quote_draft"
  | "lead_ready" | "lead_new"
  | "deal_late" | "deal_closing"
  | "abm_step" | "task_due" | "invoice_overdue" | "mention"
  | "wfm_leave" | "wfm_correction" | "wfm_overtime"
  | "sync_failed";

export type Candidate = {
  /** Unique across kinds, e.g. "quote:<uuid>". Used for the final tie-break so ranking is deterministic. */
  id: string;
  kind: CandidateKind;
  objectType: string;
  label: string;
  href: string;
  /** Overdue / expired: days past. Upcoming: days left (0 = today). Waiting items: age in days. Always whole and >= 0. */
  days: number;
  /** The record's money value when the object has one (quote total, deal amount, invoice balance). */
  value?: number;
  /** "own": mine by owner/creator. "approver": addressed to me to decide or fix. */
  ownership: "own" | "approver";
  /** Queue items stand for several rows at once (n leave requests): the grouped line counts them. */
  count?: number;
};

export const REFRESH_COOLDOWN_MS = 5 * 60_000;
