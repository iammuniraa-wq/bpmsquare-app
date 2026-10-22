import { sanitizeSegmentFilters, sanitizeMatch, type SegmentFilter } from "@/lib/marketingSegmentation";

// The audience of the newsletter Send panel, in one pure place so the panel, the route and the tests agree.
// A saved group wins; otherwise a one-off is account types plus typed addresses; with neither, everyone
// we hold an address for. Nothing here decides who may be emailed: consent is checked per person by the
// send itself (send.ts, canContact), whatever the audience says.

export const ALL_ACCOUNT_TYPES = ["direct", "end_customer", "oem", "prospect"] as const;

export type SendAudienceInput = {
  /** A saved target group (Segmentation). Wins over the one-off fields. */
  group_id?: unknown;
  /** One-off: account types to include. */
  account_types?: unknown;
  /** One-off: extra addresses, added to the group or the types. */
  manual_emails?: unknown;
};

export type AudienceRule = {
  account_types: string[];
  include_account_ids: string[];
  exclude_account_ids: string[];
  manual_emails: string[];
  filters: SegmentFilter[];
  match: "all" | "any";
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function cleanEmails(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  for (const raw of input) {
    const email = String(raw).trim().toLowerCase();
    if (email && EMAIL_RE.test(email)) seen.add(email);
  }
  return [...seen];
}

/** Typed text (commas, semicolons, spaces or lines) to a list of addresses; anything that is not an address is dropped. */
export function parseEmailText(text: string): string[] {
  return cleanEmails(text.split(/[\s,;]+/));
}

type SavedGroup = { account_types: string[] | null; include_account_ids: string[] | null; exclude_account_ids: string[] | null; manual_emails: string[] | null; filters: unknown; match: unknown };

export function ruleFromGroup(g: SavedGroup, extraEmails: string[] = []): AudienceRule {
  return {
    account_types: g.account_types ?? [],
    include_account_ids: g.include_account_ids ?? [],
    exclude_account_ids: g.exclude_account_ids ?? [],
    manual_emails: [...new Set([...(g.manual_emails ?? []), ...extraEmails])],
    filters: sanitizeSegmentFilters(g.filters),
    match: sanitizeMatch(g.match),
  };
}

export function oneOffRule(input: SendAudienceInput): AudienceRule {
  const manual = cleanEmails(input.manual_emails);
  const asked = Array.isArray(input.account_types) ? input.account_types.filter((t): t is string => (ALL_ACCOUNT_TYPES as readonly string[]).includes(String(t))) : [];
  // No types and no typed addresses is the default audience, not an empty one.
  const types = asked.length === 0 && manual.length === 0 ? [...ALL_ACCOUNT_TYPES] : asked;
  return { account_types: [...new Set(types)], include_account_ids: [], exclude_account_ids: [], manual_emails: manual, filters: [], match: "all" };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The campaign row the panel creates behind the scenes: the newsletter's own name and the day, so history reads clearly. */
export function campaignNameFor(newsletterName: string, at: Date): string {
  const name = newsletterName.trim() || "Newsletter";
  return `${name} · ${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]} ${at.getUTCFullYear()}`.slice(0, 160);
}
