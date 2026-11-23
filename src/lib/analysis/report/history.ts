import { ROUTES } from "@/lib/constants";
import { assembleInSystem, type InSystemRaw } from "../inSystem";
import { ROLE_FUNCTIONS, type RoleFunction } from "./types";

// "Your history with them" (docs/design/company-brief-sales.md rule 8): what the workspace's own records say about this company,
// read live for the person who opens the card, through their own permissions. It is NEVER sent to the web, NEVER put in the cached
// brief (the cache is shared by the whole workspace and this depends on who is looking) and NEVER put in the timeline copy. The
// numbers and names here come from the workspace's own tables, so they may be named in full; they reach only this person's screen.
// Pure: the loader (historyServer.ts) reads the rows, this turns them into what the card draws. Client-safe.

export type FunctionContacts = { count: number; first: { name: string; title: string | null } };

export type BriefHistory = {
  inCrm: boolean;
  owner: string | null;
  /** Null: the person may not view that object, so it is not mentioned at all. */
  openDeals: number | null;
  openQuotes: number | null;
  openCases: number | null;
  lastActivity: { text: string; href?: string } | null;
  contactCount: number | null;
  /** Contacts the workspace holds in each buying function. A function with none is absent. */
  byFunction: Partial<Record<RoleFunction, FunctionContacts>>;
  /** For a company that is not an account: existing accounts with a similar name or the same website. */
  similar: { id: string; name: string; href: string }[];
  href: string | null;
};

// The more specific words first: "purchasing manager" is procurement, not a manager in general. A title that matches no function
// is simply not counted in a function (it still counts in contactCount).
const FUNCTION_WORDS: [RoleFunction, RegExp][] = [
  ["procurement", /\b(procure|purchas|buyer|sourcing|supply chain|supplier|contracts? (manager|administrator)|logistics)/i],
  ["finance", /\b(financ|accountant|accounts (payable|receivable)|controller|treasur|cfo|credit)/i],
  ["executive", /\b(ceo|chief executive|managing director|\bmd\b|owner|founder|president|chairman|general manager|partner)\b/i],
  ["projects", /\b(project|construction|site (manager|engineer)|planning|programme|program manager|estimat)/i],
  ["operations", /\b(operation|plant|factory|production|yard|maintenance|quality|engineer|technical|manufactur)/i],
];

/** The buying function a contact's title or department points at, or null. */
export function functionOfTitle(...parts: (string | null | undefined)[]): RoleFunction | null {
  const t = parts.filter(Boolean).join(" ");
  if (!t.trim()) return null;
  for (const [fn, re] of FUNCTION_WORDS) if (re.test(t)) return fn;
  return null;
}

/** What the card draws from the workspace's own rows. */
export function buildBriefHistory(raw: InSystemRaw): BriefHistory {
  const inSystem = assembleInSystem(raw);
  const byFunction: BriefHistory["byFunction"] = {};
  for (const c of raw.contacts ?? []) {
    const fn = functionOfTitle(c.title, c.department);
    if (!fn) continue;
    const held = byFunction[fn];
    if (held) held.count++;
    else byFunction[fn] = { count: 1, first: { name: c.name, title: c.title } };
  }
  return {
    inCrm: inSystem.inCrm,
    owner: raw.account?.owner ?? null,
    openDeals: raw.deals ? raw.deals.length : null,
    openQuotes: raw.quotes ? raw.quotes.length : null,
    openCases: raw.cases ? raw.cases.length : null,
    lastActivity: raw.lastActivity ? { text: raw.lastActivity.text, ...(raw.lastActivity.href ? { href: raw.lastActivity.href } : {}) } : null,
    contactCount: raw.contacts ? raw.contacts.length : null,
    byFunction,
    similar: inSystem.similar,
    href: raw.account ? ROUTES.account(raw.account.id) : null,
  };
}

/** "none in procurement and finance": the functions the brief names that the workspace holds no contact in. Empty when contacts are not visible. */
export function contactGapsFor(history: BriefHistory, functions: readonly RoleFunction[]): RoleFunction[] {
  if (history.contactCount === null || !history.inCrm) return [];
  return ROLE_FUNCTIONS.filter((fn) => functions.includes(fn) && !history.byFunction[fn]);
}
