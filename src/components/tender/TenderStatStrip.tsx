import StatTile, { StatStrip } from "@/components/ui/StatTile";
import { toneForDaysLeft, type Tone } from "@/lib/ui/tone";
import { closingState, TENDER_DECISION_LABEL, type TenderDecision } from "@/lib/tender/rules";
import { bondState, type BondStatus, type BondTone } from "@/lib/tender/bond";
import { TENDER_TIPS } from "@/lib/tender/tips";

// The strip at the top of the Tender tab (colour system, docs/design/colour-system.md): the closing countdown, the bid decision, the
// bond and the open work, from what the tab already holds. The words carry the meaning; the tint only agrees with them.

const BOND_TONE: Record<BondTone, Tone> = { none: "neutral", ok: "good", amber: "warn", red: "bad" };

export default function TenderStatStrip({ closingAt, nowIso, timezone, finished, decision, approvalPending, bond, openQuestions, overdueSteps }: {
  closingAt: string | null;
  nowIso: string;
  timezone: string;
  /** Submitted or closed: the closing date is a date, not a countdown. */
  finished: boolean;
  decision: TenderDecision | null;
  /** A proposal is waiting for an approver (the proposed decision), or null. */
  approvalPending: TenderDecision | null;
  bond: { amount: number | null; expiry: string | null; status: BondStatus };
  /** null when the workspace has no Deal Room. */
  openQuestions: number | null;
  overdueSteps: number;
}) {
  const now = new Date(nowIso);
  const closing = closingState(closingAt, now, timezone);
  const date = closingAt ? new Date(closingAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: timezone }) : null;
  // The closing chip turns amber under 7 days; the tile follows the same line so the two never disagree on one screen.
  const closingTone: Tone = finished ? "neutral" : toneForDaysLeft(closing.days, 7);

  const decisionTone: Tone = approvalPending ? "warn" : decision === "go" ? "good" : decision === "no_go" ? "bad" : "neutral";
  const decisionValue = approvalPending ? "Awaiting approval" : decision ? TENDER_DECISION_LABEL[decision] : "Not decided";
  const decisionSub = approvalPending ? `${TENDER_DECISION_LABEL[approvalPending]} proposed` : decision ? "recorded" : "no proposal yet";

  const b = bondState({ bid_bond_amount: bond.amount, bid_bond_expiry: bond.expiry, bond_status: bond.status }, now, timezone);

  const open = (openQuestions ?? 0) + overdueSteps;
  const openParts = [openQuestions !== null ? `${openQuestions} open question${openQuestions === 1 ? "" : "s"}` : null, `${overdueSteps} overdue step${overdueSteps === 1 ? "" : "s"}`].filter(Boolean).join(" · ");

  return (
    <StatStrip guide="tender.strip">
      <StatTile tone={closingTone} label="Closing" info={TENDER_TIPS.closing} value={finished ? (date ?? "No closing date") : closing.label} sub={finished ? "no longer a deadline" : (date ?? "set a closing date")} />
      <StatTile tone={decisionTone} label="Bid decision" info={TENDER_TIPS.decision} value={decisionValue} sub={decisionSub} />
      <StatTile tone={BOND_TONE[b.tone]} label="Bid bond" info={TENDER_TIPS.bond} value={b.tone === "none" ? "None" : b.label} sub={b.tone === "none" ? "no bond recorded" : bond.expiry ? `valid to ${bond.expiry}` : "no expiry set"} />
      <StatTile tone={open > 0 ? "warn" : "neutral"} label="Open work" value={String(open)} sub={openParts} />
    </StatStrip>
  );
}
