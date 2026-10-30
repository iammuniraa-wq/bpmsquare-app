// "Suggest from market research" (KAMCO feedback slice 8, docs/design/kamco-feedback-build-spec.md section 10). PURE: the questions asked
// before anything runs, and the validation that decides what of the model's answer may be shown at all. No I/O and no server imports, so
// the route, the screen and the tests share one reading of "what is a sourced fact".
//
// The rule behind every line here: the model's JSON is data to check, never a result to trust. A fact survives only when the page it names
// is one the search provider itself reported (the response's own citation blocks, not the model's word for it), is https, reads like a fact
// and not like an instruction, and belongs to a company that is not already on the tender. A price figure survives only when that number
// is in the cited text. Anything less is dropped, and what is dropped is reported (never silently). "Unknown" / "not found" are the only
// fallbacks.

import { cleanText, looksLikeInstruction, normaliseUrl, parseWhen, type Citation } from "@/lib/analysis/validate";
import { hostOfUrl, normaliseName } from "@/lib/analysis/companyKey";
import { COMPETITOR_LIMITS, normaliseWebsite, sameCompany, type CompetitorEvidence, type ResearchAnswers, type SourcedFact } from "./rules";

export const RESEARCH_LIMITS = {
  /** Companies one run may propose. */
  proposals: 6,
  /** Facts kept per company. */
  facts: 5,
  factChars: 200,
  /** Runs per tender per day (each run is several web searches). */
  perDay: 3,
  /** BOQ descriptions sent to the model, and their length. */
  items: 8,
  itemChars: 80,
} as const;

/** The meter row of a run: counted per tender per day (the daily cap) and per workspace per month (the allowance). */
export const RESEARCH_SURFACE = "competitor_research";

export const DAILY_CAP_MESSAGE = `Market research ran ${RESEARCH_LIMITS.perDay} times today for this tender. Try again tomorrow.`;
export const NO_PROPOSALS_NOTICE = "No sourced competitors were found. Nothing was saved.";
export const TIMEOUT_MESSAGE = "The research took too long and was stopped. Nothing was saved.";

export const WEB_OFF_TEXT = {
  flag_off: "Web research is not switched on for this workspace.",
  needs_assistant: "Web research needs the AI assistant, which is not switched on for this workspace.",
  policy: "Your workspace blocks calls to outside services, so web research is off.",
} as const;

// ── The three questions ─────────────────────────────────────────────────────────────────────────────────────────────

export type QuestionKey = "scope" | "region" | "issuer_type";
export type Question = { key: QuestionKey; text: string; options: { value: string; label: string }[] };
export type PartialAnswers = Partial<Pick<ResearchAnswers, QuestionKey>>;

const VALUES: Record<QuestionKey, readonly string[]> = {
  scope: ["supply", "supply_install"],
  region: ["country", "gcc"],
  issuer_type: ["government", "semi", "private"],
};

/** The answers in a request body or in storage: only known keys with known values; anything else is ignored. */
export function parseAnswers(raw: unknown): PartialAnswers {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const key of Object.keys(VALUES) as QuestionKey[]) {
    const v = r[key];
    if (typeof v === "string" && VALUES[key].includes(v)) out[key] = v;
  }
  return out as PartialAnswers;
}

/** What is known: the saved answers (unless the person asked to be asked again) with this request's answers over them. */
export function mergeAnswers(saved: unknown, body: unknown, fresh: boolean): PartialAnswers {
  return { ...(fresh ? {} : parseAnswers(saved)), ...parseAnswers(body) };
}

export function completeAnswers(a: PartialAnswers): Pick<ResearchAnswers, QuestionKey> | null {
  return a.scope && a.region && a.issuer_type ? { scope: a.scope, region: a.region, issuer_type: a.issuer_type } : null;
}

/** The questions still open, in the order they are asked. Nothing is assumed from the tender text. */
export function missingQuestions(a: PartialAnswers, ctx: { country: string | null }): Question[] {
  const all: Question[] = [
    { key: "scope", text: "Is this a supply-only tender, or supply and install?", options: [{ value: "supply", label: "Supply only" }, { value: "supply_install", label: "Supply and install" }] },
    { key: "region", text: "Where should I look for competitors?", options: [{ value: "country", label: `${ctx.country || "This country"} only` }, { value: "gcc", label: "GCC" }] },
    { key: "issuer_type", text: "Who issues the tender?", options: [{ value: "government", label: "Government" }, { value: "semi", label: "Semi-government" }, { value: "private", label: "Private" }] },
  ];
  return all.filter((q) => !a[q.key]);
}

/** "Research assumes: supply and install · GCC · government", the muted line on the tab. */
export function assumesLine(a: Pick<ResearchAnswers, QuestionKey>, country: string | null): string {
  return [
    a.scope === "supply" ? "supply only" : "supply and install",
    a.region === "gcc" ? "GCC" : `${country || "this country"} only`,
    a.issuer_type === "semi" ? "semi-government" : a.issuer_type,
  ].join(" · ");
}

// ── The prompt ──────────────────────────────────────────────────────────────────────────────────────────────────────

export type CompetitorPromptInput = {
  title: string;
  tender_no: string | null;
  issuer_name: string | null;
  scope: ResearchAnswers["scope"];
  region: ResearchAnswers["region"];
  issuer_type: ResearchAnswers["issuer_type"];
  country: string | null;
  /** The first BOQ descriptions: what the tender is for. */
  items: string[];
  /** Every competitor already on the tender, proposed and rejected included. */
  exclude: string[];
};

// ── Validation ──────────────────────────────────────────────────────────────────────────────────────────────────────

export type Proposal = {
  name: string;
  website: string | null;
  country: string | null;
  evidence: CompetitorEvidence;
};

export type DropReason = "no_name" | "no_fact" | "uncited" | "duplicate" | "not_https" | "instruction" | "too_long" | "over_limit";
export type Dropped = { reason: DropReason; name?: string };

export type ValidateCtx = {
  citations: Citation[];
  /** Names already on the tender (any status). */
  exclude: string[];
  now: Date;
  model?: string;
};

const asRecord = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const FACT_KINDS = ["profile", "award", "project", "tender", "strength", "other"] as const;

const SCALE: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, mn: 1e6, mm: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9 };

/** Every number a text states, with million / billion / k scaling applied ("SAR 1.9 million" is 1,900,000). */
export function numbersIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(thousand|million|billion|mn|mm|bn|k|m|b)?\b/gi)) {
    const n = Number(m[1].replace(/,/g, ""));
    if (!Number.isFinite(n)) continue;
    out.push(n);
    const scale = m[2] ? SCALE[m[2].toLowerCase()] : undefined;
    if (scale) out.push(n * scale);
  }
  return out;
}

/** A figure the model gives is kept only when the same number is in the cited text (within a rounding of 0.5 percent). */
export function amountIsStated(amount: unknown, haystack: string): amount is number {
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) return false;
  return numbersIn(haystack).some((n) => n > 0 && Math.abs(n - amount) / amount <= 0.005);
}

const sameName = (a: string, b: string) => sameCompany(a, b) || (normaliseName(a) !== "" && normaliseName(a) === normaliseName(b));

/**
 * What of the model's answer may be shown. `citations` are the pages the provider reported (collectCitations on its own response blocks),
 * never the model's list. Returns the proposals (at most six) and what was dropped and why.
 */
export function validateCompetitorResearch(raw: unknown, ctx: ValidateCtx): { proposals: Proposal[]; dropped: Dropped[] } {
  const proposals: Proposal[] = [];
  const dropped: Dropped[] = [];
  const root = asRecord(raw);
  const list = root && Array.isArray(root.competitors) ? root.competitors : [];

  const cites = new Map<string, Citation>();
  for (const c of ctx.citations) {
    if (typeof c?.url !== "string") continue;
    try { if (new URL(c.url).protocol !== "https:") continue; } catch { continue; }
    cites.set(normaliseUrl(c.url), c);
  }
  const check = (urlRaw: unknown): { url: string; cite: Citation } | "not_https" | "uncited" => {
    if (typeof urlRaw !== "string" || !urlRaw.trim()) return "uncited";
    try { if (new URL(urlRaw.trim()).protocol !== "https:") return "not_https"; } catch { return "uncited"; }
    const key = normaliseUrl(urlRaw.trim());
    const cite = cites.get(key);
    return cite ? { url: key, cite } : "uncited";
  };

  const taken: string[] = [...ctx.exclude];
  for (const item of list) {
    if (proposals.length >= RESEARCH_LIMITS.proposals) break;
    const r = asRecord(item);
    const name = cleanText(r?.name).slice(0, COMPETITOR_LIMITS.nameMax);
    // An organisation, never a person: a name that is an address or a phone number is not one.
    if (!r || name.length < 2 || /@|https?:|\d{6,}/.test(name) || looksLikeInstruction(name)) { dropped.push({ reason: "no_name", ...(name ? { name } : {}) }); continue; }
    if (taken.some((t) => sameName(t, name))) { dropped.push({ reason: "duplicate", name }); continue; }

    const facts: SourcedFact[] = [];
    const reasons: DropReason[] = [];
    const seenText = new Set<string>();
    for (const f of Array.isArray(r.facts) ? r.facts : []) {
      const x = asRecord(f);
      const text = cleanText(x?.text);
      if (!x || !text) continue;
      if (text.length > RESEARCH_LIMITS.factChars) { reasons.push("too_long"); continue; }
      if (looksLikeInstruction(text)) { reasons.push("instruction"); continue; }
      const src = check(x.source_url);
      if (typeof src === "string") { reasons.push(src); continue; }
      const dedupe = text.toLowerCase();
      if (seenText.has(dedupe)) continue;
      seenText.add(dedupe);
      if (facts.length >= RESEARCH_LIMITS.facts) continue;
      const published = parseWhen(x.published_on, ctx.now);
      facts.push({
        text,
        kind: (FACT_KINDS as readonly unknown[]).includes(x.kind) ? (x.kind as SourcedFact["kind"]) : "other",
        source_url: src.url,
        source_title: cleanText(src.cite.title).slice(0, 200) || null,
        published_on: published ?? null,
      });
    }
    if (facts.length === 0) {
      dropped.push({ reason: (["instruction", "not_https", "uncited", "too_long"] as const).find((x) => reasons.includes(x)) ?? "no_fact", name });
      continue;
    }

    // Price and a win against us: a statement with a cited https source, or nothing. The figure must be in the cited text.
    let price: CompetitorEvidence["price"] = null;
    const p = asRecord(r.price);
    if (p) {
      const text = cleanText(p.text);
      const src = check(p.source_url);
      if (text && text.length <= 300 && !looksLikeInstruction(text) && typeof src !== "string") {
        const hay = `${text} ${src.cite.title ?? ""} ${src.cite.snippet ?? ""}`;
        price = { text, amount: amountIsStated(p.amount, hay) ? p.amount : null, source_url: src.url };
      }
    }
    let wins: CompetitorEvidence["wins"] = null;
    const w = asRecord(r.wins);
    if (w) {
      const text = cleanText(w.text);
      const src = check(w.source_url);
      if (text && text.length <= 300 && !looksLikeInstruction(text) && typeof src !== "string") wins = { text, source_url: src.url };
    }

    // A website only when a page the search read is on that site; a country only when a kept fact or a cited page names it.
    const site = normaliseWebsite(typeof r.website === "string" ? r.website : "");
    const siteHost = typeof site === "string" ? hostOfUrl(site) : null;
    const website = site && siteHost && [...cites.keys()].some((u) => { const h = hostOfUrl(u); return !!h && (h === siteHost || h.endsWith(`.${siteHost}`)); }) ? site : null;
    const countryRaw = cleanText(r.country).slice(0, COMPETITOR_LIMITS.countryMax);
    const evidenceText = [...facts.map((f) => `${f.text} ${cites.get(f.source_url)?.title ?? ""} ${cites.get(f.source_url)?.snippet ?? ""}`)].join(" ").toLowerCase();
    const country = countryRaw && evidenceText.includes(countryRaw.toLowerCase()) ? countryRaw : null;

    taken.push(name);
    proposals.push({
      name, website, country,
      evidence: { v: 1, facts, price, wins, researched_at: ctx.now.toISOString(), model: ctx.model ?? "" },
    });
  }
  if (list.length > RESEARCH_LIMITS.proposals && proposals.length >= RESEARCH_LIMITS.proposals) {
    for (const item of list.slice(RESEARCH_LIMITS.proposals)) dropped.push({ reason: "over_limit", ...(typeof asRecord(item)?.name === "string" ? { name: cleanText(asRecord(item)!.name) } : {}) });
  }
  return { proposals, dropped };
}
