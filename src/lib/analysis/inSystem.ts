import { ROUTES } from "@/lib/constants";
import { nameSimilarity, normaliseDomain, urlOnDomain } from "./companyKey";
import type { ContactLine, Gap, InSystem, Line } from "./types";

// "What we have in our system": the pure half. The loader (loadInSystem.ts) reads the workspace's own tables with the
// tenant and the person's permissions and hands the rows here; a part the person may not view arrives as null and is not
// mentioned at all. Nothing here touches the web. Pure.

export const BUYING_ROLES = ["decision_maker", "procurement", "technical"] as const;
export type BuyingRole = (typeof BUYING_ROLES)[number];
export const ROLE_TEXT: Record<BuyingRole, string> = { decision_maker: "decision maker", procurement: "procurement", technical: "technical" };

// The more specific words first: "purchasing manager" is procurement, not a manager in general.
const ROLE_WORDS: [BuyingRole, RegExp][] = [
  ["procurement", /\b(procure|purchas|buyer|sourcing|supply chain|contracts? manager)/i],
  ["technical", /\b(engineer|technical|technician|maintenance|plant|factory|production|quality|operations)/i],
  ["decision_maker", /\b(owner|founder|ceo|chief|managing director|\bmd\b|president|general manager|director|vp\b|vice president|head of|chairman|partner)/i],
];

export function roleOfTitle(...parts: (string | null | undefined)[]): BuyingRole | null {
  const t = parts.filter(Boolean).join(" ");
  if (!t.trim()) return null;
  for (const [role, re] of ROLE_WORDS) if (re.test(t)) return role;
  return null;
}

export function contactGaps(contacts: readonly { title?: string | null; department?: string | null }[]): Gap[] {
  const held = new Set(contacts.map((c) => roleOfTitle(c.title, c.department)).filter(Boolean));
  return BUYING_ROLES.filter((r) => !held.has(r)).map((r) => ({ role: r, text: `No ${ROLE_TEXT[r]} contact yet` }));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function monthYear(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
export function dayMonth(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

const titleCase = (s: string) => s.replace(/[_-]+/g, " ").replace(/^./, (c) => c.toUpperCase());

export type InSystemRaw = {
  account: { id: string; name: string; type: string | null; owner: string | null; createdAt: string | null } | null;
  /** Null: the person may not view contacts, or the module is off. */
  contacts: { id: string; name: string; title: string | null; department: string | null }[] | null;
  quotes: { id: string; ref: string | null; total: number | null; createdAt: string | null }[] | null;
  deals: { id: string; title: string | null; amount: number | null; stage: string | null }[] | null;
  cases: { id: string; ref: string | null; status: string | null }[] | null;
  invoices: { id: string; ref: string | null; total: number | null; paid: number | null; dueDate: string | null; status: string | null }[] | null;
  lastActivity: { text: string; date: string; href?: string } | null;
  /** Existing accounts, for "similar" when the company is not one. */
  accountNames: { id: string; name: string; website: string | null }[] | null;
  subject: { name: string; domain: string | null };
  now: Date;
  formatValue: (n: number) => string;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const MAX_LINES = 3;

export function assembleInSystem(r: InSystemRaw): InSystem {
  const out: InSystem = {
    inCrm: !!r.account, account: [], contacts: [], gaps: [], openQuotes: [], openCases: [], invoicesDue: [],
    lastActivity: r.lastActivity, missing: [], similar: [],
  };

  if (!r.account) {
    if (r.accountNames) {
      out.similar = r.accountNames
        .filter((a) => nameSimilarity(a.name, r.subject.name) >= 0.5 || (!!r.subject.domain && (normaliseDomain(a.website) === r.subject.domain || urlOnDomain(`https://${a.website ?? ""}`, r.subject.domain))))
        .sort((a, b) => nameSimilarity(b.name, r.subject.name) - nameSimilarity(a.name, r.subject.name) || a.name.localeCompare(b.name))
        .slice(0, 3).map((a) => ({ id: a.id, name: a.name, href: ROUTES.account(a.id) }));
    }
    return out;
  }

  const a = r.account;
  if (a.type) out.account.push({ text: `Type: ${titleCase(a.type)}` });
  out.account.push({ text: a.owner ? `Owner: ${a.owner}` : "No owner yet" });
  if (a.createdAt) out.account.push({ text: `In your system since ${monthYear(a.createdAt)}` });

  if (r.contacts) {
    out.contacts = r.contacts.slice(0, 5).map((c): ContactLine => {
      const role = roleOfTitle(c.title, c.department);
      return { id: c.id, name: c.name, ...(c.title ? { title: c.title } : {}), ...(role ? { role: ROLE_TEXT[role] } : {}), href: ROUTES.contact(c.id) };
    });
    out.gaps = contactGaps(r.contacts);
    if (r.contacts.length === 0) out.missing.push("No contacts yet");
    for (const g of out.gaps) if (r.contacts.length > 0) out.missing.push(g.text.replace(/ yet$/, ""));
  }

  if (r.quotes || r.deals) {
    const lines: Line[] = [];
    if (r.quotes && r.quotes.length > 0) {
      const total = r.quotes.reduce((t, q) => t + (q.total ?? 0), 0);
      lines.push({ text: `${plural(r.quotes.length, "open quote", "open quotes")}, ${r.formatValue(total)}`, href: ROUTES.quotations });
    }
    if (r.deals && r.deals.length > 0) {
      const total = r.deals.reduce((t, d) => t + (d.amount ?? 0), 0);
      lines.push({ text: `${plural(r.deals.length, "open deal", "open deals")}, ${r.formatValue(total)}`, href: ROUTES.pipeline });
    }
    out.openQuotes = lines;
    if (lines.length === 0) out.missing.push("No open quotes or deals");
  }

  if (r.cases) {
    out.openCases = r.cases.length > 0
      ? [{ text: plural(r.cases.length, "open case", "open cases"), href: ROUTES.cases }]
      : [];
  }

  if (r.invoices) {
    const due = r.invoices.filter((i) => (i.total ?? 0) - (i.paid ?? 0) > 0);
    if (due.length > 0) {
      const amount = due.reduce((t, i) => t + ((i.total ?? 0) - (i.paid ?? 0)), 0);
      const late = due.filter((i) => i.dueDate && Date.parse(`${i.dueDate.slice(0, 10)}T00:00:00Z`) < r.now.getTime()).length;
      out.invoicesDue = [{ text: `${plural(due.length, "invoice", "invoices")} unpaid, ${r.formatValue(amount)}${late > 0 ? `, ${late} overdue` : ""}`, href: ROUTES.invoices }];
    }
  }
  out.openQuotes = out.openQuotes.slice(0, MAX_LINES);
  return out;
}
