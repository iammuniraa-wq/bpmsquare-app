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

export const COMPETITOR_STATUSES = ["proposed", "accepted", "rejected"] as const;
export type CompetitorStatus = (typeof COMPETITOR_STATUSES)[number];
export type CompetitorOrigin = "manual" | "research";

/**
 * A fact found by market research, with the page it came from. A fact without a source is never kept (researchRules.ts), so every
 * `source_url` here is an https page the search actually returned.
 */
export type SourcedFact = {
  text: string;
  kind: "profile" | "award" | "project" | "tender" | "strength" | "other";
  source_url: string;
  source_title: string | null;
  published_on: string | null;
};

export type CompetitorEvidence = {
  v: 1;
  facts: SourcedFact[];
  /** What a page states about their pricing, or a comparable award value. `amount` only when the page gives a number. */
  price: { text: string; amount: number | null; source_url: string } | null;
  /** A win against us that a page states. */
  wins: { text: string; source_url: string } | null;
  researched_at: string;
  model: string;
};

/** One competitor as the screen and the API hand it out. */
export type CompetitorView = CompetitorFields & {
  id: string;
  is_winner: boolean;
  sort: number;
  created_at: string;
  /** proposed = from market research, not yet accepted. Rows saved before migration 0239 read as accepted. */
  status: CompetitorStatus;
  origin: CompetitorOrigin;
  evidence: CompetitorEvidence | null;
};

/** What the research was told, kept on the tender as context. Informative only: it never becomes a tender field. */
export type ResearchAnswers = { scope: "supply" | "supply_install"; region: "country" | "gcc"; issuer_type: "government" | "semi" | "private"; answered_at?: string };

export type CompetitorsData = {
  /** Proposed and accepted competitors (rejected ones are kept out of sight so research does not propose them again). */
  competitors: CompetitorView[];
  /** The table is not there yet (migration 0229). */
  pending: boolean;
  /** Migration 0239 is not applied: no status, origin or evidence yet, so market research cannot save anything. */
  researchPending?: boolean;
  /** Whether Company insights may be offered on this workspace for this person, and the plain reason when not. */
  insights: { available: boolean; reason?: string };
  /** Our latest submitted bid, to set a competitor's likely price against. */
  our_bid?: { total: number; currency: string | null; version_no: number } | null;
  /** What the last research run assumed (scope, region, issuer type). */
  research?: ResearchAnswers | null;
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

/** The fields an edit may change, plus the winner flag and Accept / Reject for a proposal. Only keys present in the body are returned. */
export function parseCompetitorEdit(body: unknown): Parsed<Partial<CompetitorFields> & { is_winner?: boolean; status?: "accepted" | "rejected" }> {
  const b = asBody(body);
  const out: Partial<CompetitorFields> & { is_winner?: boolean; status?: "accepted" | "rejected" } = {};
  for (const key of FIELDS) {
    const problem = parseField(b, key, out);
    if (problem) return { ok: false, error: problem };
  }
  if ("is_winner" in b) {
    if (typeof b.is_winner !== "boolean") return { ok: false, error: "is_winner must be true or false" };
    out.is_winner = b.is_winner;
  }
  if ("status" in b) {
    if (b.status !== "accepted" && b.status !== "rejected") return { ok: false, error: "status must be accepted or rejected" };
    out.status = b.status;
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
  /** Accepted competitors only: a proposal is not on the tender until it is accepted. */
  total: number;
  /** Expected to quote below us. */
  cheaper: number;
  /** Competitors with a price position recorded. */
  priced: number;
  /** Waiting for a yes or no. */
  proposed: number;
  winner: string | null;
};

export function competitorStats(list: readonly Pick<CompetitorView, "expected_price" | "is_winner" | "name" | "status">[]): CompetitorStats {
  const accepted = list.filter((c) => c.status === "accepted");
  return {
    total: accepted.length,
    cheaper: accepted.filter((c) => c.expected_price === "lower").length,
    priced: accepted.filter((c) => c.expected_price !== null).length,
    proposed: list.filter((c) => c.status === "proposed").length,
    winner: accepted.find((c) => c.is_winner)?.name ?? null,
  };
}

/** The winner first, then the accepted ones in the team's order, then the proposals waiting for an answer. */
export function inDisplayOrder<T extends { is_winner: boolean; sort: number; created_at: string; status?: CompetitorStatus }>(list: readonly T[]): T[] {
  const proposed = (x: T) => (x.status === "proposed" ? 1 : 0);
  return [...list].sort((a, b) => Number(b.is_winner) - Number(a.is_winner) || proposed(a) - proposed(b) || a.sort - b.sort || a.created_at.localeCompare(b.created_at));
}

// ── Evidence read back from the database ─────────────────────────────────────────────────────────────────────────────

const FACT_KINDS = ["profile", "award", "project", "tender", "strength", "other"] as const;
const isHttps = (v: unknown): v is string => {
  if (typeof v !== "string") return false;
  try { return new URL(v).protocol === "https:"; } catch { return false; }
};

/**
 * `evidence` is jsonb: whatever is stored, the screen only ever draws facts whose source is an https page. A malformed value, a
 * version we do not know or a fact with a source that is not https is dropped, never shown. Null when nothing usable is left.
 */
export function readEvidence(raw: unknown): CompetitorEvidence | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  if (e.v !== 1 || !Array.isArray(e.facts)) return null;
  const facts: SourcedFact[] = [];
  for (const f of e.facts) {
    if (!f || typeof f !== "object") continue;
    const x = f as Record<string, unknown>;
    if (typeof x.text !== "string" || !x.text.trim() || !isHttps(x.source_url)) continue;
    facts.push({
      text: x.text.trim().slice(0, 400),
      kind: (FACT_KINDS as readonly unknown[]).includes(x.kind) ? (x.kind as SourcedFact["kind"]) : "other",
      source_url: x.source_url,
      source_title: typeof x.source_title === "string" && x.source_title.trim() ? x.source_title.trim().slice(0, 200) : null,
      published_on: typeof x.published_on === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x.published_on) ? x.published_on : null,
    });
  }
  const p = e.price && typeof e.price === "object" ? (e.price as Record<string, unknown>) : null;
  const price = p && typeof p.text === "string" && p.text.trim() && isHttps(p.source_url)
    ? { text: p.text.trim().slice(0, 400), amount: typeof p.amount === "number" && Number.isFinite(p.amount) && p.amount > 0 ? p.amount : null, source_url: p.source_url }
    : null;
  const w = e.wins && typeof e.wins === "object" ? (e.wins as Record<string, unknown>) : null;
  const wins = w && typeof w.text === "string" && w.text.trim() && isHttps(w.source_url) ? { text: w.text.trim().slice(0, 400), source_url: w.source_url } : null;
  if (facts.length === 0 && !price && !wins) return null;
  return {
    v: 1, facts, price, wins,
    researched_at: typeof e.researched_at === "string" ? e.researched_at : "",
    model: typeof e.model === "string" ? e.model : "",
  };
}

/** "example.com" for a link label when the page has no title. */
export function sourceHost(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

/** Their likely price against our bid: a signed percent measured on our bid ("-4.0%": they are expected below us). Null without both figures. */
export function priceGap(theirs: number | null | undefined, ours: number | null | undefined): { pct: number; label: string } | null {
  if (typeof theirs !== "number" || typeof ours !== "number" || !Number.isFinite(theirs) || !Number.isFinite(ours) || theirs <= 0 || ours <= 0) return null;
  const pct = Math.round(((theirs - ours) / ours) * 1000) / 10;
  return { pct, label: `${pct > 0 ? "+" : pct < 0 ? "-" : ""}${Math.abs(pct).toFixed(1)}%` };
}

/** The answers kept on the tender as research context. Anything that is not one of the known values is ignored, so a hand-edited value cannot reach a prompt. */
export function readResearchAnswers(raw: unknown): ResearchAnswers | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if ((r.scope !== "supply" && r.scope !== "supply_install") || (r.region !== "country" && r.region !== "gcc")) return null;
  if (r.issuer_type !== "government" && r.issuer_type !== "semi" && r.issuer_type !== "private") return null;
  return { scope: r.scope, region: r.region, issuer_type: r.issuer_type, ...(typeof r.answered_at === "string" ? { answered_at: r.answered_at } : {}) };
}
