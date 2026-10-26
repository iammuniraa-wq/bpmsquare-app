// GCC tender deals, the Competitors tab (migration 0229): the companies we expect to bid against on one deal. PURE: field checks, the
// labels and the figures on the strip, shared by the routes, the screen and the tests.

export const COMPETITOR_PRICES = ["lower", "similar", "higher"] as const;
export type CompetitorPrice = (typeof COMPETITOR_PRICES)[number];
/** The price position is read from our side: "Below us" means they are expected to quote less than we do. */
export const COMPETITOR_PRICE_LABEL: Record<CompetitorPrice, string> = { lower: "Below us", similar: "Similar", higher: "Above us" };

export const COMPETITOR_LIMITS = {
  nameMax: 200, websiteMax: 300, countryMax: 80, strengthsMax: 1000, notesMax: 2000,
  /** Competitors one deal can hold: a guard against a runaway script, far above real use. */
  perDeal: 30,
  /** Cards shown before "Show all". */
  shown: 6,
} as const;

export type CompetitorFields = {
  name: string;
  website: string | null;
  country: string | null;
  expected_price: CompetitorPrice | null;
  strengths: string | null;
  notes: string | null;
};

/** One competitor as the screen and the API hand it out. */
export type CompetitorView = CompetitorFields & {
  id: string;
  is_winner: boolean;
  sort: number;
  created_at: string;
};

export type CompetitorsData = {
  competitors: CompetitorView[];
  /** The table is not there yet (migration 0229). */
  pending: boolean;
  /** Whether Company insights may be offered on this workspace for this person, and the plain reason when not. */
  insights: { available: boolean; reason?: string };
};

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const text = (v: unknown) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "");
const paragraph = (v: unknown) => (typeof v === "string" ? v.replace(/\r\n/g, "\n").trim() : "");

const HOST = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

/** "www.Rival.com/about?x=1" -> "https://www.rival.com/about". Empty -> null. Anything that is not a web address -> undefined. */
export function normaliseWebsite(v: unknown): string | null | undefined {
  const raw = typeof v === "string" ? v.trim() : "";
  if (!raw) return null;
  if (/\s/.test(raw)) return undefined;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  let u: URL;
  try { u = new URL(withScheme); } catch { return undefined; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return undefined;
  if (u.username || u.password || u.port) return undefined;
  if (!HOST.test(u.hostname)) return undefined;
  const path = u.pathname.replace(/\/+$/, "");
  return `https://${u.hostname.toLowerCase()}${path}`.slice(0, COMPETITOR_LIMITS.websiteMax);
}

function parseField(b: Record<string, unknown>, key: keyof CompetitorFields, out: Partial<CompetitorFields>): string | null {
  if (!(key in b)) return null;
  const v = b[key];
  switch (key) {
    case "name": {
      const s = text(v);
      if (!s) return "Say who the competitor is";
      if (s.length > COMPETITOR_LIMITS.nameMax) return `The name is too long (${COMPETITOR_LIMITS.nameMax} characters at most)`;
      out.name = s;
      return null;
    }
    case "website": {
      const w = normaliseWebsite(v);
      if (w === undefined) return "That is not a web address (for example rival.com)";
      out.website = w;
      return null;
    }
    case "country": {
      const s = text(v);
      if (s.length > COMPETITOR_LIMITS.countryMax) return `The country is too long (${COMPETITOR_LIMITS.countryMax} characters at most)`;
      out.country = s || null;
      return null;
    }
    case "expected_price": {
      if (v === null || v === "") { out.expected_price = null; return null; }
      if (!(COMPETITOR_PRICES as readonly unknown[]).includes(v)) return "expected_price must be lower, similar or higher";
      out.expected_price = v as CompetitorPrice;
      return null;
    }
    case "strengths": {
      const s = paragraph(v);
      if (s.length > COMPETITOR_LIMITS.strengthsMax) return `Strengths are too long (${COMPETITOR_LIMITS.strengthsMax} characters at most)`;
      out.strengths = s || null;
      return null;
    }
    case "notes": {
      const s = paragraph(v);
      if (s.length > COMPETITOR_LIMITS.notesMax) return `The note is too long (${COMPETITOR_LIMITS.notesMax} characters at most)`;
      out.notes = s || null;
      return null;
    }
  }
}

const FIELDS: (keyof CompetitorFields)[] = ["name", "website", "country", "expected_price", "strengths", "notes"];
const asBody = (body: unknown) => (body && typeof body === "object" ? body : {}) as Record<string, unknown>;

/** A new competitor. Only the name is required. Anything not on the allow-list (the tenant, the winner flag, the maker) is ignored. */
export function parseNewCompetitor(body: unknown): Parsed<CompetitorFields> {
  const b = asBody(body);
  if (!("name" in b)) return { ok: false, error: "Say who the competitor is" };
  const out: Partial<CompetitorFields> = {};
  for (const key of FIELDS) {
    const problem = parseField(b, key, out);
    if (problem) return { ok: false, error: problem };
  }
  return { ok: true, value: { name: out.name!, website: out.website ?? null, country: out.country ?? null, expected_price: out.expected_price ?? null, strengths: out.strengths ?? null, notes: out.notes ?? null } };
}

/** The fields an edit may change, plus the winner flag. Only keys present in the body are returned. */
export function parseCompetitorEdit(body: unknown): Parsed<Partial<CompetitorFields> & { is_winner?: boolean }> {
  const b = asBody(body);
  const out: Partial<CompetitorFields> & { is_winner?: boolean } = {};
  for (const key of FIELDS) {
    const problem = parseField(b, key, out);
    if (problem) return { ok: false, error: problem };
  }
  if ("is_winner" in b) {
    if (typeof b.is_winner !== "boolean") return { ok: false, error: "is_winner must be true or false" };
    out.is_winner = b.is_winner;
  }
  if (Object.keys(out).length === 0) return { ok: false, error: "Nothing to change" };
  return { ok: true, value: out };
}

/** Does this name already belong to one of the deal's competitors? Same company, whatever the case or the spacing. */
export const sameCompany = (a: string, b: string): boolean => text(a).toLowerCase() === text(b).toLowerCase();

export function findByName<T extends { name: string }>(list: readonly T[], name: string): T | null {
  return list.find((c) => sameCompany(c.name, name)) ?? null;
}

export type CompetitorStats = {
  total: number;
  /** Expected to quote below us. */
  cheaper: number;
  /** Competitors with a price position recorded. */
  priced: number;
  winner: string | null;
};

export function competitorStats(list: readonly Pick<CompetitorView, "expected_price" | "is_winner" | "name">[]): CompetitorStats {
  return {
    total: list.length,
    cheaper: list.filter((c) => c.expected_price === "lower").length,
    priced: list.filter((c) => c.expected_price !== null).length,
    winner: list.find((c) => c.is_winner)?.name ?? null,
  };
}

/** The winner first, then the order the team keeps them in. */
export function inDisplayOrder<T extends { is_winner: boolean; sort: number; created_at: string }>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => Number(b.is_winner) - Number(a.is_winner) || a.sort - b.sort || a.created_at.localeCompare(b.created_at));
}

/** "Company insights" is offered per card; "Analyse all" confirms with this sentence, which states the number of calls. */
export function analyseAllSentence(count: number): string {
  return `This runs ${count} company ${count === 1 ? "analysis" : "analyses"}, one at a time. Each searches the public web and uses part of your AI allowance, unless a saved card is still fresh.`;
}
