import type { AccountType } from "@/lib/types";
import type { SegmentFilter } from "@/lib/marketingSegmentation";

// The audience a campaign is aimed at, compared by value (docs/design/marketing-two-parts.md, slice 3). The picker uses
// this to say honestly whether the current rule IS "everyone", a saved audience, or a one-off the person has changed.

export const ALL_ACCOUNT_TYPES: AccountType[] = ["direct", "end_customer", "oem", "prospect"];

export type RuleParts = {
  types: Set<AccountType>; includeIds: Set<string>; excludeIds: Set<string>; manualEmails: Set<string>;
  filters: SegmentFilter[]; match: "all" | "any";
};

/** The default audience: every account type, nothing added or removed. */
export const EVERYONE: RuleParts = { types: new Set(ALL_ACCOUNT_TYPES), includeIds: new Set(), excludeIds: new Set(), manualEmails: new Set(), filters: [], match: "all" };

const sorted = (x: Set<string>) => [...x].sort();

/** Two rules are the same audience when this string is equal. `match` only counts when there are filters. */
export function ruleKey(r: RuleParts): string {
  return JSON.stringify([sorted(r.types), sorted(r.includeIds), sorted(r.excludeIds), sorted(r.manualEmails), r.filters.length ? r.filters : [], r.filters.length ? r.match : "all"]);
}
