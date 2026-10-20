import { ABM_PROGRESS, PROGRESS_LABEL, type AbmProgress, type AbmRole } from "./types";
import { roleGaps } from "./roles";

// Progress is a status, not a score (docs/abm-architecture.md section 5.2).
// Fixed rules over the shared event stream, pure and explainable: the answer
// always says which rule fired and which events stand behind it, with dates,
// because that sentence is what the "Why this status" popover shows.
//
// A rule only ever moves a target FORWARD. Backward moves, Dropped and the
// in-talks step (a meeting happened -- the product cannot know) are a
// person's, and a person's change needs a reason (validateManualProgress).
// Won and Lost follow the linked deal.

const RANK: Record<AbmProgress, number> = {
  planned: 0, reached: 1, engaged: 2, in_talks: 3, deal_open: 4, won: 5, lost: 5, dropped: -1,
};

/** Events that mean "we reached them": something was delivered or sent to a buying-group member. */
export const REACH_EVENTS = ["email.delivered", "whatsapp.delivered", "quote.sent"] as const;
/** Events that mean "they engaged": a buying-group member did something. Opens are not here: unreliable. */
export const ENGAGE_EVENTS = [
  "email.clicked", "email.interest", "quote.opened", "quote.accepted", "quote.change_requested",
  "form.submitted", "whatsapp.replied", "web.page_viewed",
] as const;

const VERB: Record<string, string> = {
  "email.delivered": "was sent an email",
  "whatsapp.delivered": "was sent a WhatsApp message",
  "quote.sent": "was sent a quote",
  "email.clicked": "clicked a link in an email",
  "email.interest": "showed interest in an email",
  "quote.opened": "opened a quote",
  "quote.accepted": "accepted a quote",
  "quote.change_requested": "asked for a change to a quote",
  "form.submitted": "filled in a form",
  "whatsapp.replied": "replied on WhatsApp",
  "web.page_viewed": "viewed a page",
};

export type ProgressEvent = {
  name: string;
  occurred_at: string;
  contact_id: string | null;
};

export type LinkedDeal = {
  id: string;
  ref: string | null;
  outcome: "open" | "won" | "lost" | "dropped";
  amount: number | null;
  closed_at: string | null;
};

export type ProgressMember = { contact_id: string; role: AbmRole; name?: string | null };

export type ProgressInput = {
  current: AbmProgress;
  currentSource: "rule" | "manual";
  /** When the company joined the program: earlier events do not count. */
  addedAt: string;
  members: ProgressMember[];
  requiredRoles: readonly AbmRole[];
  /** Owner decision 2026-10-19: strict by default, so the gap bites. */
  engagedNeedsRequiredRoles: boolean;
  events: ProgressEvent[];
  deal: LinkedDeal | null;
};

export type ProgressEvidence = { name: string; at: string; who: string | null; text: string };

export type ProgressVerdict = {
  progress: AbmProgress;
  changed: boolean;
  /** Which rule fired; null when nothing moved. */
  rule: "deal_closed" | "deal_open" | "engaged" | "reached" | null;
  /** One plain sentence, with dates. */
  reason: string;
  /** The events behind it, newest first. */
  evidence: ProgressEvidence[];
  /** Set when a rule would have moved the target but something stops it ("would be Engaged -- no decision maker named yet"). */
  held: string | null;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "8 Oct 2026", always in UTC so the same instant reads the same on server and client. */
export function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

const rank = (p: AbmProgress) => RANK[p];

function evidenceFor(events: ProgressEvent[], names: readonly string[], members: ProgressMember[], since: string): ProgressEvidence[] {
  const byContact = new Map(members.map((m) => [m.contact_id, m]));
  const from = new Date(since).getTime();
  return events
    .filter((e) => names.includes(e.name) && e.contact_id && byContact.has(e.contact_id) && new Date(e.occurred_at).getTime() >= from)
    .sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime())
    .map((e) => {
      const who = byContact.get(e.contact_id as string)?.name ?? null;
      return { name: e.name, at: e.occurred_at, who, text: `${who ?? "Someone in the buying group"} ${VERB[e.name] ?? e.name}, ${shortDate(e.occurred_at)}` };
    });
}

export function deriveProgress(input: ProgressInput): ProgressVerdict {
  const { current } = input;
  const keep = (held: string | null = null): ProgressVerdict => ({ progress: current, changed: false, rule: null, reason: "", evidence: [], held });

  // Dropped is a person's decision; Won and Lost are final until a person reopens.
  if (current === "dropped" || current === "won" || current === "lost") return keep();

  const { deal } = input;
  if (deal && (deal.outcome === "won" || deal.outcome === "lost" || deal.outcome === "dropped")) {
    const to: AbmProgress = deal.outcome === "won" ? "won" : "lost";
    const label = deal.ref ?? "The linked deal";
    const when = deal.closed_at ? `, ${shortDate(deal.closed_at)}` : "";
    return {
      progress: to, changed: true, rule: "deal_closed", held: null, evidence: [],
      reason: deal.outcome === "won"
        ? `${label} was won${deal.amount ? ` (${Math.round(deal.amount).toLocaleString("en-US")})` : ""}${when}`
        : `${label} was ${deal.outcome === "dropped" ? "dropped" : "lost"}${when}`,
    };
  }
  if (deal && deal.outcome === "open") {
    if (rank(current) >= rank("deal_open")) return keep();
    return { progress: "deal_open", changed: true, rule: "deal_open", held: null, evidence: [], reason: `${deal.ref ?? "A deal"} is open for this company` };
  }

  // In talks is only ever set by a person; nothing below it can be jumped to from there.
  const engagedEvidence = evidenceFor(input.events, ENGAGE_EVENTS, input.members, input.addedAt);
  const reachedEvidence = evidenceFor(input.events, REACH_EVENTS, input.members, input.addedAt);

  if (engagedEvidence.length > 0 && rank(current) < rank("engaged")) {
    const gaps = roleGaps(input.requiredRoles, input.members);
    if (input.engagedNeedsRequiredRoles && gaps.length > 0) {
      const held = `Would be Engaged, but ${gaps.map((g) => g.text.toLowerCase().replace(/ yet$/, "")).join(" and ")} is named in the buying group`;
      if (rank(current) < rank("reached")) {
        // Engagement implies we reached them; still move to Reached.
        return { progress: "reached", changed: true, rule: "reached", held, evidence: engagedEvidence, reason: engagedEvidence[0].text };
      }
      return keep(held);
    }
    return { progress: "engaged", changed: true, rule: "engaged", held: null, evidence: engagedEvidence, reason: engagedEvidence[0].text };
  }

  if (reachedEvidence.length > 0 && rank(current) < rank("reached")) {
    return { progress: "reached", changed: true, rule: "reached", held: null, evidence: reachedEvidence, reason: reachedEvidence[0].text };
  }

  return keep();
}

/**
 * A person changing progress: the reason is required (the owner's rule),
 * the new value must be one of the eight, and Dropped is the only state
 * that also needs the dropped_reason column filled.
 */
export function validateManualProgress(to: unknown, reason: unknown): { ok: true; progress: AbmProgress; reason: string } | { ok: false; error: string } {
  if (typeof to !== "string" || !(ABM_PROGRESS as readonly string[]).includes(to)) return { ok: false, error: "Choose a progress from the list." };
  const text = typeof reason === "string" ? reason.trim() : "";
  if (!text) return { ok: false, error: `Say why you are setting this to ${PROGRESS_LABEL[to as AbmProgress]}. A manual change always needs a reason.` };
  if (text.length > 500) return { ok: false, error: "Keep the reason under 500 characters." };
  return { ok: true, progress: to as AbmProgress, reason: text };
}

/** Plain words for the "Why this status" popover: what the status means and what moves it next. */
export const PROGRESS_MEANING: Record<AbmProgress, { means: string; next: string }> = {
  planned: { means: "Nothing has reached anyone in the buying group yet.", next: "Moves to Reached when an email, WhatsApp message or quote is delivered to someone in the buying group." },
  reached: { means: "Something was delivered to someone in the buying group.", next: "Moves to Engaged when someone in the buying group clicks, opens a quote, fills a form or replies. By default the required roles must be named first." },
  engaged: { means: "Someone in the buying group did something in response.", next: "Moves to In talks when a person sets it after a meeting, and to Deal open when a deal is linked." },
  in_talks: { means: "A person recorded that a conversation is under way.", next: "Moves to Deal open when a deal is linked." },
  deal_open: { means: "A deal is open for this company.", next: "Moves to Won or Lost when the linked deal is closed." },
  won: { means: "The linked deal was won.", next: "Final. A person can reopen it." },
  lost: { means: "The linked deal was lost or dropped.", next: "Final. A person can reopen it." },
  dropped: { means: "A person took this company off the list.", next: "Stays here until a person puts it back." },
};

/** The sentence under a Progress pill: who/what set it, in plain words. */
export function describeProgressSource(t: { progress_source: "rule" | "manual"; progress_reason: string | null; progress_changed_at: string; actorName?: string | null }): string {
  const when = shortDate(t.progress_changed_at);
  if (t.progress_source === "manual") {
    return `Set by ${t.actorName ?? "a person"}${when ? `, ${when}` : ""}${t.progress_reason ? `: ${t.progress_reason}` : ""}`;
  }
  return t.progress_reason ? `Set by rule: ${t.progress_reason}` : "Planned: nothing has happened yet";
}
