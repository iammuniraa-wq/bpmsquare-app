import { sanitizeWebText } from "@/lib/assistant/webQuery";
import { hostOfUrl, mentionsFullName, normaliseName, urlOnDomain } from "../companyKey";
import { looksPersonal } from "../subject";
import { cleanText, looksLikeInstruction, normaliseUrl, parseWhen, type Citation } from "../validate";
import {
  figureMatchesSnippets, formatEmployees, formatMoney, MAX_AMOUNT, moneyStatus, parseAmount, parseCurrency, parseFiscalYear, parseUnit, UNITS,
} from "./figures";
import { buildCorpus, inferenceProblem, type Corpus } from "./inference";
import { onPublisherHost } from "./trustedHosts";
import {
  FAIL_REASONS, MAX_REPORT_SEARCHES, OWNERSHIP_KINDS, PROXY_KINDS, REPORT_MAX_SOURCES, REPORT_PARTS, REPORT_VERSION, ROLE_FUNCTIONS, SIGNAL_KINDS, WATCHOUT_KINDS,
  type CompanyReport, type FitBlock, type Money, type OwnershipKind, type ProxyKind, type ReportCompete, type ReportItem, type ReportLens,
  type FailReason, type ReportPartId, type ReportSource, type RoleFunction, type RoleRow, type SignalKind, type WatchoutKind,
} from "./types";

// validateBrief(): everything the four research parts say about a company passes through here and nothing else reaches the
// card (docs/design/company-brief-sales.md sections 4 and 5). Pure and deterministic. A statement is kept only when it has a
// text that reads like a fact, a page the provider itself cited and an https address; a number is a field, a figure's digits are
// checked against the cited snippet, growth and margin are worked out by our code, and an inference line that brings in a
// number or a name the facts do not hold is dropped. Web text is data: the model's words are never drawn raw, only these fields.

export const LIMITS = {
  signals: 8, namedPerRole: 3, watchouts: 6, competitors: 6, marketFacts: 6, what: 3, clients: 6, projects: 6,
  perfMarket: 3, highlights: 5, tailwinds: 4, headwinds: 4, proxies: 4, years: 3, priorities: 3, questions: 3, compete: 6,
} as const;

const MAX_TEXT = 320;
const MAX_SHORT = 160;
const MAX_INFERENCE = 220;
const DAY = 86_400_000;
/** A dated event older than this is not a reason to call this month. */
const SIGNAL_MAX_AGE_DAYS = 400;
const WATCHOUT_MAX_AGE_DAYS = 5 * 365;
const MAX_EMPLOYEES = 5_000_000;
const STALE_DAYS = 180;

export type ReportDropReason =
  | "not_an_object" | "no_text" | "too_long" | "instruction" | "no_source" | "not_https" | "uncited" | "other_company" | "no_date" | "too_old"
  | "bad_money" | "bad_fact" | "bad_kind" | "bad_hiring" | "bad_person" | "bad_competitor" | "bad_basis" | "invented_fact"
  | "unlisted_offering" | "no_offerings" | "over_cap" | "duplicate";

export type ReportDropBlock = "money" | "facts" | "signals" | "roles" | "performance" | "watchouts" | "market" | "profile" | "fit";

export type PartsRaw = Partial<Record<ReportPartId, unknown>>;

export type ReportValidateCtx = {
  /** The vetted subject: the brief is always headed with this name, never with one the model wrote. */
  subject: { name: string; domain: string | null; country: string | null };
  /** Every page any part cited, merged (see mergeCitations). */
  citations: readonly Citation[];
  now: Date;
  searches: number;
  lens?: ReportLens;
  /** Parts that failed. A part with no raw result is missing whether or not it is listed here. */
  missing?: readonly ReportPartId[];
  /** Why each failed part failed, as a code. Kept on the brief for the parts that are missing, so the card can say why. */
  reasons?: Partial<Record<ReportPartId, FailReason>>;
};

export type ValidatedReport = { report: CompanyReport; dropped: { reason: ReportDropReason; block: ReportDropBlock }[] };

type Rec = Record<string, unknown>;
const asRecord = (v: unknown): Rec | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : null);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : asRecord(v) ? [v] : []);

/** The pages of several parts as one list: one entry per page, the snippets of every part kept (three at most). */
export function mergeCitations(lists: readonly (readonly Citation[])[]): Citation[] {
  const out = new Map<string, Citation>();
  for (const l of lists) {
    for (const c of l) {
      if (typeof c?.url !== "string") continue;
      const key = normaliseUrl(c.url);
      const prev = out.get(key);
      const snippets = [...new Set([...(prev?.snippets ?? []), ...(c.snippets ?? []), ...(c.snippet ? [c.snippet] : [])])].filter(Boolean).slice(0, 3);
      out.set(key, { url: prev?.url ?? c.url, title: prev?.title || c.title, snippet: prev?.snippet || c.snippet, ...(snippets.length ? { snippets } : {}) });
    }
  }
  return [...out.values()];
}

/** A date as the page gave it: a day, a month ("2026-03" stays a month) or, where allowed, just a year. Never in the future, never before 1990. */
function parseDate(v: unknown, now: Date, allowYear = false): string | undefined {
  const full = parseWhen(v, now);
  if (full) return typeof v === "string" && /^\d{4}-\d{2}$/.test(v.trim()) ? v.trim() : full;
  const t = typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
  if (allowYear && /^\d{4}$/.test(t) && Number(t) >= 1990 && Number(t) <= now.getUTCFullYear()) return t;
  return undefined;
}

/** The latest moment a date can mean: "2025" is the end of 2025, so a year-only date never ages faster than it should. */
const whenMs = (on: string): number => Date.parse(`${on.length === 4 ? `${on}-12-31` : on.length === 7 ? `${on}-28` : on}T00:00:00Z`);

/** A page's own site is "the company's own" when its host is the company's domain, or (no domain known) the host's name is the company's name. */
function onOwnSite(url: string, subject: ReportValidateCtx["subject"]): boolean {
  if (subject.domain) return urlOnDomain(url, subject.domain);
  const host = hostOfUrl(url);
  const squash = (s: string) => s.replace(/[^\p{L}\p{N}]+/gu, "");
  const name = squash(normaliseName(subject.name));
  if (!host || name.length < 4) return false;
  const label = squash(host.split(".").slice(0, -1).join("."));
  return label.length >= 4 && (label === name || label.startsWith(name) || name.startsWith(label));
}

type Staged = { order: number; url: string; facts: string[]; dates: string[]; apply: (n: number, corpus: Corpus) => void };

/** Block order is the order a reader meets the sources: the tiles first, then the blocks as the card draws them. */
const ORDER = { oneLiner: 0, hq: 1, ownership: 2, employees: 3, revenue: 4, profit: 5, proxy: 6, signal: 7, role: 8, perf: 9, watchout: 10, market: 11, competitor: 12, profile: 13 } as const;

// Reasons that say "no page backed this", counted in the muted "left out" line. A duplicate, a cap and an inference that was
// dropped are not statements a page failed to back.
const NOT_LEFT_OUT = new Set<ReportDropReason>(["duplicate", "no_offerings", "invented_fact", "unlisted_offering", "bad_basis", "over_cap"]);

export function validateBrief(parts: PartsRaw, ctx: ReportValidateCtx): ValidatedReport {
  const dropped: ValidatedReport["dropped"] = [];
  const drop = (reason: ReportDropReason, block: ReportDropBlock) => { dropped.push({ reason, block }); };
  const lens: ReportLens = ctx.lens ?? "prospect";
  const missing = REPORT_PARTS.filter((p) => !asRecord(parts[p]) || (ctx.missing ?? []).includes(p));

  const cites = new Map<string, Citation>();
  for (const c of ctx.citations) {
    if (typeof c?.url !== "string") continue;
    try { if (new URL(c.url).protocol !== "https:") continue; } catch { continue; }
    cites.set(normaliseUrl(c.url), c);
  }

  const checkSource = (urlRaw: unknown): { ok: true; url: string; cite: Citation } | { ok: false; reason: "no_source" | "not_https" | "uncited" } => {
    if (typeof urlRaw !== "string" || !urlRaw.trim()) return { ok: false, reason: "no_source" };
    try { if (new URL(urlRaw.trim()).protocol !== "https:") return { ok: false, reason: "not_https" }; } catch { return { ok: false, reason: "no_source" }; }
    const url = normaliseUrl(urlRaw.trim());
    const cite = cites.get(url);
    return cite ? { ok: true, url, cite } : { ok: false, reason: "uncited" };
  };

  const cleanStatement = (v: unknown, max: number): { ok: true; text: string } | { ok: false; reason: "no_text" | "too_long" | "instruction" } => {
    const t = cleanText(v);
    if (!t) return { ok: false, reason: "no_text" };
    const s = sanitizeWebText(t);
    if (s.removed > 0 || looksLikeInstruction(t)) return { ok: false, reason: "instruction" };
    const text = s.text.replace(/\s+/g, " ").trim();
    if (text.length < 8) return { ok: false, reason: "no_text" };
    if (text.length > max) return { ok: false, reason: "too_long" };
    return { ok: true, text };
  };

  const out: CompanyReport = {
    v: REPORT_VERSION, name: ctx.subject.name, domain: ctx.subject.domain, country: ctx.subject.country, lens,
    oneLiner: null, facts: {}, money: { revenue: [], profit: [], status: "not_published", proxies: [] },
    signals: [], roles: [], performance: { market: [], highlights: [], tailwinds: [], headwinds: [] }, watchouts: [],
    market: { facts: [], competitors: [] }, profile: { what: [], clients: [], projects: [] }, fit: null, compete: [],
    sources: [], leftOut: 0, searches: Math.min(Math.max(0, Math.floor(ctx.searches)), MAX_REPORT_SEARCHES), missing, generatedAt: ctx.now.toISOString(),
  };
  const keptReasons: Partial<Record<ReportPartId, FailReason>> = {};
  for (const p of missing) { const why = ctx.reasons?.[p]; if (why && (FAIL_REASONS as readonly string[]).includes(why)) keptReasons[p] = why; }
  if (Object.keys(keptReasons).length > 0) out.reasons = keptReasons;

  const staged: Staged[] = [];
  const post: ((corpus: Corpus) => void)[] = [];
  const seen = new Set<string>();
  const dup = (key: string, block: ReportDropBlock): boolean => {
    if (seen.has(key)) { drop("duplicate", block); return true; }
    seen.add(key);
    return false;
  };

  /** A plain sourced statement: text, a page, optionally a date. Null after recording why not. */
  const statement = (item: unknown, block: ReportDropBlock, o: { max?: number; needDate?: boolean } = {}):
  { text: string; url: string; cite: Citation; on?: string; r: Rec } | null => {
    const r = asRecord(item);
    if (!r) { drop("not_an_object", block); return null; }
    const text = cleanStatement(r.text, o.max ?? MAX_TEXT);
    if (!text.ok) { drop(text.reason, block); return null; }
    const src = checkSource(r.source_url);
    if (!src.ok) { drop(src.reason, block); return null; }
    if (r.about_subject === false) { drop("other_company", block); return null; }
    const on = parseDate(r.published_on, ctx.now);
    if (o.needDate && !on) { drop("no_date", block); return null; }
    return { text: text.text, url: src.url, cite: src.cite, on, r };
  };

  const itemList = (raw: unknown, block: ReportDropBlock, order: number, max: number, into: ReportItem[]) => {
    let taken = 0;
    for (const item of list(raw)) {
      const s = statement(item, block);
      if (!s) continue;
      if (dup(`${block}|${order}|${s.text.toLowerCase()}`, block)) continue;
      if (taken >= max) { drop("over_cap", block); continue; }
      taken++;
      staged.push({
        order, url: s.url, facts: [s.text], dates: s.on ? [s.on] : [],
        apply: (n) => { into.push({ text: s.text, src: n, ...(s.on ? { on: s.on, ...(staleOn(s.on) ? { old: true } : {}) } : {}) }); },
      });
    }
  };

  const staleOn = (on: string): boolean => ctx.now.getTime() - whenMs(on) > STALE_DAYS * DAY;

  const fin = asRecord(parts.financials);
  const sig = asRecord(parts.signals);
  const ppl = asRecord(parts.people);
  const mkt = asRecord(parts.market);

  // ── Money: the amount as printed, the unit the page used, a currency and a fiscal year. Never a sentence. ──────────────
  const stageMoney = (series: "revenue" | "profit") => {
    const rows: { m: Omit<Money, "src">; url: string }[] = [];
    for (const item of list(fin?.[series])) {
      const r = asRecord(item);
      if (!r) { drop("not_an_object", "money"); continue; }
      const printed = parseAmount(r.amount);
      const unit = parseUnit(r.unit);
      const currency = parseCurrency(r.currency);
      const fiscalYear = parseFiscalYear(r.fiscal_year, ctx.now);
      const src = checkSource(r.source_url);
      if (printed === null || !unit || !currency || fiscalYear === null || !src.ok) { drop(src.ok ? "bad_money" : src.reason, "money"); continue; }
      if (r.about_subject === false) { drop("other_company", "money"); continue; }
      const amount = Math.round(printed * UNITS[unit] * 100) / 100;
      if (!Number.isFinite(amount) || Math.abs(amount) > MAX_AMOUNT || (series === "revenue" && amount <= 0)) { drop("bad_money", "money"); continue; }
      const snippets = src.cite.snippets ?? (src.cite.snippet ? [src.cite.snippet] : []);
      rows.push({ m: { amount, currency, fiscalYear, matched: figureMatchesSnippets(printed, snippets) }, url: src.url });
    }
    // One figure per year and currency (the first the model gave), the latest three years.
    const unique: typeof rows = [];
    for (const r of rows) {
      if (unique.some((u) => u.m.fiscalYear === r.m.fiscalYear && u.m.currency === r.m.currency)) { drop("duplicate", "money"); continue; }
      unique.push(r);
    }
    unique.sort((a, b) => b.m.fiscalYear - a.m.fiscalYear);
    unique.forEach((r, i) => {
      if (i >= LIMITS.years) { drop("over_cap", "money"); return; }
      staged.push({
        order: series === "revenue" ? ORDER.revenue : ORDER.profit, url: r.url,
        facts: [formatMoney(r.m.amount, r.m.currency), String(r.m.fiscalYear)], dates: [],
        apply: (n) => { out.money[series].push({ ...r.m, src: n }); },
      });
    });
  };
  if (fin) {
    stageMoney("revenue");
    stageMoney("profit");
    let taken = 0;
    for (const item of list(fin.proxies)) {
      const r = asRecord(item);
      const kind = typeof r?.kind === "string" && (PROXY_KINDS as readonly string[]).includes(r.kind) ? (r.kind as ProxyKind) : null;
      if (!kind) { drop(r ? "bad_kind" : "not_an_object", "money"); continue; }
      const s = statement(item, "money", { max: MAX_SHORT });
      if (!s) continue;
      if (dup(`proxy|${s.text.toLowerCase()}`, "money")) continue;
      if (taken >= LIMITS.proxies) { drop("over_cap", "money"); continue; }
      taken++;
      staged.push({ order: ORDER.proxy, url: s.url, facts: [s.text], dates: [], apply: (n) => { out.money.proxies.push({ kind, text: s.text, src: n }); } });
    }
    itemList(fin.market, "performance", ORDER.perf, LIMITS.perfMarket, out.performance.market);
    itemList(fin.highlights, "performance", ORDER.perf, LIMITS.highlights, out.performance.highlights);
    itemList(fin.tailwinds, "performance", ORDER.perf, LIMITS.tailwinds, out.performance.tailwinds);
    itemList(fin.headwinds, "performance", ORDER.perf, LIMITS.headwinds, out.performance.headwinds);
  }

  // ── Signals: dated, from a fixed list of kinds. "Why it matters" is the assistant's reading and is checked after numbering. ──
  const readingOf = (raw: unknown, block: ReportDropBlock, corpus: Corpus): string => {
    if (raw === undefined || raw === null || !cleanText(raw)) return "";
    const w = cleanStatement(raw, MAX_INFERENCE);
    if (!w.ok) { drop(w.reason, block); return ""; }
    if (inferenceProblem(w.text, corpus)) { drop("invented_fact", block); return ""; }
    return w.text;
  };

  const stageSignal = (item: unknown, forceKind?: SignalKind) => {
    const r = asRecord(item);
    if (!r) { drop("not_an_object", "signals"); return; }
    const kind = forceKind ?? (typeof r.kind === "string" && (SIGNAL_KINDS as readonly string[]).includes(r.kind) ? (r.kind as SignalKind) : null);
    if (!kind) { drop("bad_kind", "signals"); return; }
    const s = statement(item, "signals", { max: MAX_SHORT * 2, needDate: true });
    if (!s) return;
    const on = s.on!;
    if (whenMs(on) < ctx.now.getTime() - SIGNAL_MAX_AGE_DAYS * DAY) { drop("too_old", "signals"); return; }
    // Hiring names functions and counts ("9 procurement and planning roles"), never a recruiter or a hiring manager.
    if (kind === "hiring" && (!/\d/.test(s.text) || /recruiter|hiring manager|talent acquisition|talent partner|headhunter/i.test(s.text) || looksPersonal(s.text))) { drop("bad_hiring", "signals"); return; }
    if (dup(`signal|${s.text.toLowerCase()}`, "signals")) return;
    staged.push({
      order: ORDER.signal, url: s.url, facts: [s.text], dates: [on],
      apply: (n, corpus) => {
        out.signals.push({ kind, text: s.text, on, src: n, ...(staleOn(on) ? { old: true } : {}), why: readingOf(r.why, "signals", corpus) });
      },
    });
  };
  if (sig) {
    list(sig.signals).forEach((item) => stageSignal(item));
  }
  if (ppl) list(ppl.hiring).forEach((item) => stageSignal(item, "hiring"));

  // ── Roles: a function from a fixed list; names only as the company itself publishes them. ───────────────────────────────
  if (ppl) {
    const namesSeen = new Set<string>();
    const fnSeen = new Set<RoleFunction>();
    const rowOf = (fn: RoleFunction): RoleRow => {
      let row = out.roles.find((x) => x.fn === fn);
      if (!row) { row = { fn, talkAbout: "", named: [] }; out.roles.push(row); }
      return row;
    };
    for (const item of list(ppl.roles)) {
      const r = asRecord(item);
      if (!r) { drop("not_an_object", "roles"); continue; }
      const fn = typeof r.function === "string" && (ROLE_FUNCTIONS as readonly string[]).includes(r.function.trim().toLowerCase()) ? (r.function.trim().toLowerCase() as RoleFunction) : null;
      if (!fn) { drop("bad_kind", "roles"); continue; }
      if (fnSeen.has(fn)) { drop("duplicate", "roles"); continue; }
      fnSeen.add(fn);
      let named = 0;
      for (const pItem of list(r.named)) {
        const p = asRecord(pItem);
        const name = cleanText(p?.name);
        const title = cleanText(p?.title);
        const src = checkSource(p?.source_url);
        const clean = !!p && name.length >= 3 && name.length <= 80 && name.split(" ").length <= 6 && title.length >= 2 && title.length <= 80
          && !/[@\d]/.test(name) && !looksPersonal(title) && !/\d{4,}/.test(title) && !looksLikeInstruction(`${name} ${title}`)
          && !/https?:|www\.|linkedin|facebook|instagram|twitter/i.test(`${name} ${title}`);
        if (!p || !clean || !src.ok) { drop("bad_person", "roles"); continue; }
        // The company's own site, or a filing or press release it issued, hosted by an exchange, regulator or newswire (the page must name the company).
        const own = onOwnSite(src.url, ctx.subject);
        const pageText = `${src.cite.title ?? ""} ${(src.cite.snippets ?? [src.cite.snippet ?? ""]).join(" ")}`;
        const hosted = !own && onPublisherHost(src.url) && mentionsFullName(pageText, ctx.subject.name);
        if (!own && !hosted) { drop("bad_person", "roles"); continue; }
        if (namesSeen.has(name.toLowerCase())) { drop("duplicate", "roles"); continue; }
        if (named >= LIMITS.namedPerRole) { drop("over_cap", "roles"); continue; }
        namesSeen.add(name.toLowerCase());
        named++;
        staged.push({ order: ORDER.role, url: src.url, facts: [name, title], dates: [], apply: (n) => { rowOf(fn).named.push({ name, title, src: n }); } });
      }
      post.push((corpus) => {
        const talk = readingOf(r.talk_about, "roles", corpus);
        if (talk) rowOf(fn).talkAbout = talk;
      });
    }
  }

  // ── Watch-outs: dated, from a fixed list of kinds. ────────────────────────────────────────────────────────────────────────
  if (mkt) {
    for (const item of list(mkt.watchouts)) {
      const r = asRecord(item);
      if (!r) { drop("not_an_object", "watchouts"); continue; }
      const kind = typeof r.kind === "string" && (WATCHOUT_KINDS as readonly string[]).includes(r.kind) ? (r.kind as WatchoutKind) : null;
      if (!kind) { drop("bad_kind", "watchouts"); continue; }
      const s = statement(item, "watchouts", { max: MAX_SHORT * 2 });
      if (!s) continue;
      const on = parseDate(r.published_on, ctx.now, true);
      if (!on) { drop("no_date", "watchouts"); continue; }
      if (whenMs(on) < ctx.now.getTime() - WATCHOUT_MAX_AGE_DAYS * DAY) { drop("too_old", "watchouts"); continue; }
      if (dup(`watchout|${s.text.toLowerCase()}`, "watchouts")) continue;
      staged.push({ order: ORDER.watchout, url: s.url, facts: [s.text], dates: [on], apply: (n) => { out.watchouts.push({ kind, text: s.text, on, src: n }); } });
    }

    // Tiles: one line, head office, ownership, people, ticker.
    const one = asRecord(mkt.one_liner);
    if (one) {
      const s = statement(one, "facts", { max: 200 });
      if (s) staged.push({ order: ORDER.oneLiner, url: s.url, facts: [s.text], dates: [], apply: (n) => { out.oneLiner = { text: s.text, src: n }; } });
    }
    const hq = asRecord(mkt.hq);
    if (hq) {
      const value = cleanText(hq.value);
      const src = checkSource(hq.source_url);
      if (!src.ok || value.length < 2 || value.length > 80 || looksPersonal(value) || looksLikeInstruction(value) || sanitizeWebText(value).removed > 0) drop(src.ok ? "bad_fact" : src.reason, "facts");
      else staged.push({ order: ORDER.hq, url: src.url, facts: [value], dates: [], apply: (n) => { out.facts.hq = { value, src: n }; } });
    }
    const own = asRecord(mkt.ownership);
    if (own) {
      const kind = typeof own.kind === "string" && (OWNERSHIP_KINDS as readonly string[]).includes(own.kind) ? (own.kind as OwnershipKind) : null;
      const src = checkSource(own.source_url);
      const detail = cleanText(own.detail);
      const detailOk = !detail || (detail.length <= 60 && !looksPersonal(detail) && !looksLikeInstruction(detail) && sanitizeWebText(detail).removed === 0);
      if (!kind || !src.ok || !detailOk) drop(src.ok ? "bad_fact" : src.reason, "facts");
      else staged.push({ order: ORDER.ownership, url: src.url, facts: detail ? [detail] : [], dates: [], apply: (n) => { out.facts.ownership = { value: { kind, ...(detail ? { detail } : {}) }, src: n }; } });
    }
    const emp = asRecord(mkt.employees);
    if (emp) {
      const rawCount = parseAmount(emp.count);
      const count = rawCount === null ? null : Math.round(rawCount);
      const upTo = emp.up_to === undefined || emp.up_to === null ? undefined : parseAmount(emp.up_to);
      const src = checkSource(emp.source_url);
      const asOf = parseDate(emp.as_of, ctx.now);
      if (!src.ok || count === null || count < 1 || count > MAX_EMPLOYEES || (upTo !== undefined && (upTo === null || upTo <= count || upTo > MAX_EMPLOYEES))) drop(src.ok ? "bad_fact" : src.reason, "facts");
      else {
        const snippets = src.cite.snippets ?? (src.cite.snippet ? [src.cite.snippet] : []);
        const matched = figureMatchesSnippets(count, snippets);
        const e = { count, ...(upTo ? { upTo } : {}), approx: emp.approx !== false };
        staged.push({
          order: ORDER.employees, url: src.url, facts: [formatEmployees(e)], dates: asOf ? [asOf] : [],
          apply: (n) => { out.facts.employees = { ...e, src: n, matched, ...(asOf ? { on: asOf } : {}) }; },
        });
      }
    }
    const ticker = typeof mkt.ticker === "string" ? mkt.ticker.trim().toUpperCase() : "";
    if (ticker && /^[A-Z0-9][A-Z0-9.:-]{0,11}$/.test(ticker)) post.push(() => { out.facts.ticker = ticker; });

    itemList(mkt.market_facts, "market", ORDER.market, LIMITS.marketFacts, out.market.facts);
    itemList(mkt.what, "profile", ORDER.profile, LIMITS.what, out.profile.what);
    itemList(mkt.clients, "profile", ORDER.profile, LIMITS.clients, out.profile.clients);
    itemList(mkt.projects, "profile", ORDER.profile, LIMITS.projects, out.profile.projects);

    let competitors = 0;
    for (const item of list(mkt.competitors)) {
      const r = asRecord(item);
      if (!r) { drop("not_an_object", "market"); continue; }
      const name = cleanText(r.name);
      const how = cleanStatement(r.how, MAX_SHORT);
      const src = checkSource(r.source_url);
      const bad = name.length < 2 || name.length > 80 || /@|https?:|www\./i.test(name) || /^\d+$/.test(name) || looksPersonal(name) || looksLikeInstruction(name)
        || normaliseName(name) === normaliseName(ctx.subject.name);
      if (bad) { drop("bad_competitor", "market"); continue; }
      if (!how.ok) { drop(how.reason, "market"); continue; }
      if (!src.ok) { drop(src.reason, "market"); continue; }
      if (dup(`competitor|${normaliseName(name)}`, "market")) continue;
      if (competitors >= LIMITS.competitors) { drop("over_cap", "market"); continue; }
      competitors++;
      staged.push({ order: ORDER.competitor, url: src.url, facts: [name, how.text], dates: [], apply: (n) => { out.market.competitors.push({ name, how: how.text, src: n }); } });
    }
  }

  // ── Keep the pages that back the most statements; a statement whose page falls outside the cap goes with it. ──────────────
  const usage = new Map<string, { count: number; first: number }>();
  staged.forEach((s, i) => { const u = usage.get(s.url); if (u) u.count++; else usage.set(s.url, { count: 1, first: i }); });
  const kept = new Set([...usage.entries()].sort((a, b) => b[1].count - a[1].count || a[1].first - b[1].first).slice(0, REPORT_MAX_SOURCES).map(([u]) => u));
  const finalStaged = staged.map((s, i) => ({ s, i })).filter(({ s }) => { if (kept.has(s.url)) return true; drop("over_cap", "market"); return false; })
    .sort((a, b) => a.s.order - b.s.order || a.i - b.i).map(({ s }) => s);

  // Numbered in the order the reader meets them.
  const sources: ReportSource[] = [];
  const numberOf = new Map<string, number>();
  for (const s of finalStaged) {
    if (numberOf.has(s.url)) continue;
    const cite = cites.get(s.url)!;
    const title = cleanText(cite.title).slice(0, 160) || hostOfUrl(s.url) || s.url;
    const n = sources.length + 1;
    numberOf.set(s.url, n);
    sources.push({ n, title, url: s.url, ...(hostOfUrl(s.url) ? { publisher: hostOfUrl(s.url)! } : {}) });
  }

  // What the readings may reuse: the validated facts, the dates and the company's own name. NOT the country or city the workspace holds
  // for it: a place is a fact, and one the brief does not state (live test 2026-11-23: "Saudi Arabia" in a question) is not allowed in.
  const corpus = buildCorpus(
    [ctx.subject.name, ...finalStaged.flatMap((s) => s.facts)],
    finalStaged.flatMap((s) => s.dates),
  );
  for (const s of finalStaged) s.apply(numberOf.get(s.url)!, corpus);
  for (const p of post) p(corpus);

  // Stable, readable order.
  out.signals.sort((a, b) => b.on.localeCompare(a.on));
  out.watchouts.sort((a, b) => b.on.localeCompare(a.on));
  out.roles = ROLE_FUNCTIONS.flatMap((fn) => out.roles.filter((r) => r.fn === fn && (r.named.length > 0 || r.talkAbout)));
  out.money.revenue.sort((a, b) => a.fiscalYear - b.fiscalYear);
  out.money.profit.sort((a, b) => a.fiscalYear - b.fiscalYear);
  out.money.status = moneyStatus(out.money);
  out.sources = sources;
  out.leftOut = dropped.filter((d) => !NOT_LEFT_OUT.has(d.reason)).length;
  return { report: out, dropped };
}

// ── Where we fit and how a competitor competes: inference over validated facts and the workspace's own offering names ────────

/** Everything a validated brief states, as the words and numbers an inference may reuse, plus the workspace's offerings. */
export function reportCorpus(r: CompanyReport, offerings: readonly string[] = []): Corpus {
  // The company's own name and the offering names, then the validated facts. Not the country the workspace holds for the company.
  const texts: string[] = [r.name, ...offerings];
  const dates: string[] = [];
  if (r.oneLiner) texts.push(r.oneLiner.text);
  if (r.facts.hq) texts.push(r.facts.hq.value);
  if (r.facts.ownership) texts.push(r.facts.ownership.value.detail ?? "");
  if (r.facts.employees) { texts.push(formatEmployees(r.facts.employees)); if (r.facts.employees.on) dates.push(r.facts.employees.on); }
  for (const m of [...r.money.revenue, ...r.money.profit]) texts.push(formatMoney(m.amount, m.currency), String(m.fiscalYear));
  for (const p of r.money.proxies) texts.push(p.text);
  for (const s of r.signals) { texts.push(s.text); dates.push(s.on); }
  for (const x of r.roles) for (const p of x.named) texts.push(p.name, p.title);
  for (const i of [...r.performance.market, ...r.performance.highlights, ...r.performance.tailwinds, ...r.performance.headwinds, ...r.market.facts, ...r.profile.what, ...r.profile.clients, ...r.profile.projects]) {
    texts.push(i.text);
    if (i.on) dates.push(i.on);
  }
  for (const w of r.watchouts) { texts.push(w.text); dates.push(w.on); }
  for (const c of r.market.competitors) texts.push(c.name, c.how);
  return buildCorpus(texts, dates);
}

/** The statements a fit priority may be based on, with the short id the Fit call sees: S1.. for Why now, H1.. for Performance highlights. */
export type FitRef = { id: string; basis: { type: "signal" | "highlight"; index: number }; text: string; on?: string };
export function fitRefs(r: CompanyReport): FitRef[] {
  return [
    ...r.signals.map((s, i): FitRef => ({ id: `S${i + 1}`, basis: { type: "signal", index: i }, text: s.text, on: s.on })),
    ...r.performance.highlights.map((h, i): FitRef => ({ id: `H${i + 1}`, basis: { type: "highlight", index: i }, text: h.text, ...(h.on ? { on: h.on } : {}) })),
  ];
}

export type FitDrop = "not_an_object" | "no_text" | "too_long" | "instruction" | "bad_basis" | "unlisted_offering" | "no_offerings" | "invented_fact" | "over_cap" | "duplicate";
export type ValidatedFit = { fit: FitBlock | null; compete: ReportCompete[]; dropped: FitDrop[] };

/**
 * The Fit call's answer, checked. Prospect lens: an angle, up to three priorities (each pointing at a Why-now or Performance
 * statement that exists and naming an offering from the workspace's own list) and up to three questions. Competitor lens: how the
 * company competes with each listed offering. Every sentence passes the same instruction check as a fact, and the inference rule:
 * no number, year or name that is not in the validated facts or the offering list.
 */
export function validateFit(raw: unknown, report: CompanyReport, offerings: readonly string[], lens: ReportLens): ValidatedFit {
  const dropped: FitDrop[] = [];
  const empty: ValidatedFit = { fit: null, compete: [], dropped };
  const root = asRecord(raw);
  if (!root) return empty;
  if (offerings.length === 0) { dropped.push("no_offerings"); return empty; }
  const corpus = reportCorpus(report, offerings);
  const byLower = new Map(offerings.map((o) => [o.toLowerCase(), o]));

  const sentence = (v: unknown, max: number): string | null => {
    const t = cleanText(v);
    if (!t) { dropped.push("no_text"); return null; }
    const s = sanitizeWebText(t);
    if (s.removed > 0 || looksLikeInstruction(t)) { dropped.push("instruction"); return null; }
    const text = s.text.replace(/\s+/g, " ").trim();
    if (text.length < 8) { dropped.push("no_text"); return null; }
    if (text.length > max) { dropped.push("too_long"); return null; }
    if (inferenceProblem(text, corpus)) { dropped.push("invented_fact"); return null; }
    return text;
  };

  if (lens === "competitor") {
    const compete: ReportCompete[] = [];
    for (const item of list(root.compete)) {
      const r = asRecord(item);
      if (!r) { dropped.push("not_an_object"); continue; }
      const offering = byLower.get(cleanText(r.offering).toLowerCase());
      if (!offering) { dropped.push("unlisted_offering"); continue; }
      const text = sentence(r.text, MAX_TEXT);
      if (!text) continue;
      if (compete.some((c) => c.offering === offering)) { dropped.push("duplicate"); continue; }
      if (compete.length >= LIMITS.compete) { dropped.push("over_cap"); continue; }
      compete.push({ offering, text });
    }
    return { fit: null, compete, dropped };
  }

  const refs = new Map(fitRefs(report).map((x) => [x.id.toLowerCase(), x]));
  const priorities: FitBlock["priorities"] = [];
  for (const item of list(root.priorities)) {
    const r = asRecord(item);
    if (!r) { dropped.push("not_an_object"); continue; }
    const ref = typeof r.based_on === "string" ? refs.get(r.based_on.trim().toLowerCase()) : undefined;
    if (!ref) { dropped.push("bad_basis"); continue; }
    const offering = byLower.get(cleanText(r.offering).toLowerCase());
    if (!offering) { dropped.push("unlisted_offering"); continue; }
    const why = sentence(r.why, MAX_INFERENCE);
    if (!why) continue;
    if (priorities.some((p) => p.basedOn.type === ref.basis.type && p.basedOn.index === ref.basis.index && p.offering === offering)) { dropped.push("duplicate"); continue; }
    if (priorities.length >= LIMITS.priorities) { dropped.push("over_cap"); continue; }
    priorities.push({ basedOn: ref.basis, offering, why });
  }
  // Without one priority that points at a real statement there is nothing to base an angle on: the block is hidden.
  if (priorities.length === 0) return empty;
  const angle = sentence(root.angle, MAX_TEXT) ?? "";
  const questions: string[] = [];
  for (const q of list(root.questions)) {
    const text = sentence(q, 200);
    if (!text) continue;
    if (questions.length >= LIMITS.questions) { dropped.push("over_cap"); continue; }
    questions.push(text);
  }
  return { fit: { angle, priorities, questions }, compete: [], dropped };
}

// ── The cached brief, read back ──────────────────────────────────────────────────────────────────────────────────────────

const WHEN = /^\d{4}(-\d{2}(-\d{2})?)?$/;

/** The stored reason codes, kept only for parts that are missing and only from the fixed list. */
function reasonsOf(raw: unknown, missing: readonly ReportPartId[]): [ReportPartId, FailReason][] {
  const r = asRecord(raw);
  if (!r) return [];
  return missing.flatMap((p) => (typeof r[p] === "string" && (FAIL_REASONS as readonly string[]).includes(r[p] as string) ? [[p, r[p] as FailReason] as [ReportPartId, FailReason]] : []));
}

/**
 * A version 2 brief read back from the cache. The stored value was validated when it was written, but the table is plain jsonb,
 * so the shape is rebuilt here: anything off is dropped and a source that is not https never reaches a link. Null for anything
 * that is not version 2 (a version 1 report is read by readLegacyReport).
 */
export function readStoredReport(raw: unknown): CompanyReport | null {
  const r = asRecord(raw);
  if (!r || r.v !== REPORT_VERSION || typeof r.name !== "string" || !Array.isArray(r.sources)) return null;
  const sources: ReportSource[] = [];
  for (const s of r.sources) {
    const x = asRecord(s);
    if (!x || typeof x.url !== "string" || typeof x.n !== "number") continue;
    let u: URL;
    try { u = new URL(x.url); } catch { continue; }
    if (u.protocol !== "https:" || u.username || u.password) continue;
    sources.push({ n: x.n, title: cleanText(x.title).slice(0, 160) || u.hostname, url: u.toString(), ...(typeof x.publisher === "string" ? { publisher: cleanText(x.publisher).slice(0, 80) } : {}) });
  }
  const known = new Set(sources.map((s) => s.n));
  const src = (v: unknown): number | null => (typeof v === "number" && known.has(v) ? v : null);
  const when = (v: unknown): string | undefined => (typeof v === "string" && WHEN.test(v) ? v : undefined);
  const text = (v: unknown, max: number): string => cleanText(v).slice(0, max);
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const items = (v: unknown, max: number): ReportItem[] => {
    const out: ReportItem[] = [];
    for (const i of Array.isArray(v) ? v : []) {
      const x = asRecord(i);
      const s = src(x?.src);
      if (!x || typeof x.text !== "string" || s === null) continue;
      out.push({ text: text(x.text, MAX_TEXT), src: s, ...(when(x.on) ? { on: when(x.on) } : {}), ...(x.old === true ? { old: true } : {}) });
      if (out.length >= max) break;
    }
    return out;
  };
  const one = <T extends string>(v: unknown, set: readonly T[]): T | null => (typeof v === "string" && (set as readonly string[]).includes(v) ? (v as T) : null);

  const money = (v: unknown): Money[] => {
    const out: Money[] = [];
    for (const i of Array.isArray(v) ? v : []) {
      const x = asRecord(i);
      const s = src(x?.src);
      const amount = num(x?.amount);
      const year = num(x?.fiscalYear);
      if (!x || s === null || amount === null || year === null || typeof x.currency !== "string" || !/^[A-Z]{3}$/.test(x.currency) || Math.abs(amount) > MAX_AMOUNT) continue;
      out.push({ amount, currency: x.currency, fiscalYear: Math.round(year), src: s, matched: x.matched === true });
      if (out.length >= LIMITS.years) break;
    }
    return out;
  };

  const m = asRecord(r.money);
  const revenue = money(m?.revenue);
  const profit = money(m?.profit);
  const proxies: CompanyReport["money"]["proxies"] = [];
  for (const i of Array.isArray(m?.proxies) ? (m!.proxies as unknown[]) : []) {
    const x = asRecord(i);
    const kind = one(x?.kind, PROXY_KINDS);
    const s = src(x?.src);
    if (x && kind && s !== null && typeof x.text === "string") proxies.push({ kind, text: text(x.text, MAX_SHORT), src: s });
    if (proxies.length >= LIMITS.proxies) break;
  }

  const f = asRecord(r.facts);
  const facts: CompanyReport["facts"] = {};
  const hqSrc = src(asRecord(f?.hq)?.src);
  if (typeof asRecord(f?.hq)?.value === "string" && hqSrc !== null) facts.hq = { value: text(asRecord(f?.hq)!.value, 80), src: hqSrc };
  const ow = asRecord(f?.ownership);
  const owKind = one(asRecord(ow?.value)?.kind, OWNERSHIP_KINDS);
  const owSrc = src(ow?.src);
  if (owKind && owSrc !== null) {
    const detail = text(asRecord(ow?.value)?.detail, 60);
    facts.ownership = { value: { kind: owKind, ...(detail ? { detail } : {}) }, src: owSrc };
  }
  const em = asRecord(f?.employees);
  const emCount = num(em?.count);
  const emSrc = src(em?.src);
  if (em && emCount !== null && emCount > 0 && emCount <= MAX_EMPLOYEES && emSrc !== null) {
    const upTo = num(em.upTo);
    facts.employees = { count: Math.round(emCount), ...(upTo && upTo > emCount && upTo <= MAX_EMPLOYEES ? { upTo: Math.round(upTo) } : {}), approx: em.approx !== false, src: emSrc, matched: em.matched === true, ...(when(em.on) ? { on: when(em.on) } : {}) };
  }
  if (typeof f?.ticker === "string" && /^[A-Z0-9][A-Z0-9.:-]{0,11}$/.test(f.ticker)) facts.ticker = f.ticker;

  const signals: CompanyReport["signals"] = [];
  for (const i of Array.isArray(r.signals) ? r.signals : []) {
    const x = asRecord(i);
    const kind = one(x?.kind, SIGNAL_KINDS);
    const s = src(x?.src);
    const on = when(x?.on);
    if (x && kind && s !== null && on && typeof x.text === "string") signals.push({ kind, text: text(x.text, MAX_TEXT), on, src: s, ...(x.old === true ? { old: true } : {}), why: text(x.why, MAX_INFERENCE) });
    if (signals.length >= LIMITS.signals) break;
  }

  const roles: RoleRow[] = [];
  for (const i of Array.isArray(r.roles) ? r.roles : []) {
    const x = asRecord(i);
    const fn = one(x?.fn, ROLE_FUNCTIONS);
    if (!x || !fn) continue;
    const named: RoleRow["named"] = [];
    for (const p of Array.isArray(x.named) ? x.named : []) {
      const y = asRecord(p);
      const s = src(y?.src);
      if (y && typeof y.name === "string" && typeof y.title === "string" && s !== null) named.push({ name: text(y.name, 80), title: text(y.title, 80), src: s });
      if (named.length >= LIMITS.namedPerRole) break;
    }
    roles.push({ fn, talkAbout: text(x.talkAbout, MAX_INFERENCE), named });
  }

  const watchouts: CompanyReport["watchouts"] = [];
  for (const i of Array.isArray(r.watchouts) ? r.watchouts : []) {
    const x = asRecord(i);
    const kind = one(x?.kind, WATCHOUT_KINDS);
    const s = src(x?.src);
    const on = when(x?.on);
    if (x && kind && s !== null && on && typeof x.text === "string") watchouts.push({ kind, text: text(x.text, MAX_TEXT), on, src: s });
    if (watchouts.length >= LIMITS.watchouts) break;
  }

  const perf = asRecord(r.performance);
  const mk = asRecord(r.market);
  const competitors: CompanyReport["market"]["competitors"] = [];
  for (const i of Array.isArray(mk?.competitors) ? (mk!.competitors as unknown[]) : []) {
    const x = asRecord(i);
    const s = src(x?.src);
    if (x && s !== null && typeof x.name === "string" && typeof x.how === "string") competitors.push({ name: text(x.name, 80), how: text(x.how, MAX_SHORT), src: s });
    if (competitors.length >= LIMITS.competitors) break;
  }
  const pr = asRecord(r.profile);

  const fitRaw = asRecord(r.fit);
  let fit: FitBlock | null = null;
  if (fitRaw) {
    const priorities: FitBlock["priorities"] = [];
    for (const i of Array.isArray(fitRaw.priorities) ? fitRaw.priorities : []) {
      const x = asRecord(i);
      const b = asRecord(x?.basedOn);
      const type = b?.type === "signal" || b?.type === "highlight" ? b.type : null;
      const index = num(b?.index);
      if (x && type && index !== null && Number.isInteger(index) && index >= 0 && typeof x.offering === "string" && typeof x.why === "string") {
        priorities.push({ basedOn: { type, index }, offering: text(x.offering, 80), why: text(x.why, MAX_INFERENCE) });
      }
      if (priorities.length >= LIMITS.priorities) break;
    }
    if (priorities.length > 0) {
      fit = { angle: text(fitRaw.angle, MAX_TEXT), priorities, questions: (Array.isArray(fitRaw.questions) ? fitRaw.questions : []).filter((q): q is string => typeof q === "string").map((q) => text(q, 200)).filter(Boolean).slice(0, LIMITS.questions) };
    }
  }
  const compete: ReportCompete[] = [];
  for (const i of Array.isArray(r.compete) ? r.compete : []) {
    const x = asRecord(i);
    if (x && typeof x.offering === "string" && typeof x.text === "string") compete.push({ offering: text(x.offering, 80), text: text(x.text, MAX_TEXT) });
    if (compete.length >= LIMITS.compete) break;
  }

  const oneRaw = asRecord(r.oneLiner);
  const oneSrc = src(oneRaw?.src);
  const missing = (Array.isArray(r.missing) ? r.missing : []).filter((p): p is ReportPartId => (REPORT_PARTS as readonly string[]).includes(p as string));
  return {
    v: REPORT_VERSION, name: text(r.name, 120),
    domain: typeof r.domain === "string" ? r.domain.slice(0, 253) : null, country: typeof r.country === "string" ? text(r.country, 60) : null,
    lens: r.lens === "competitor" ? "competitor" : "prospect",
    oneLiner: oneRaw && typeof oneRaw.text === "string" && oneSrc !== null ? { text: text(oneRaw.text, 200), src: oneSrc } : null,
    facts,
    money: { revenue, profit, status: moneyStatus({ revenue, profit }), proxies },
    signals, roles,
    performance: { market: items(perf?.market, LIMITS.perfMarket), highlights: items(perf?.highlights, LIMITS.highlights), tailwinds: items(perf?.tailwinds, LIMITS.tailwinds), headwinds: items(perf?.headwinds, LIMITS.headwinds) },
    watchouts,
    market: { facts: items(mk?.facts, LIMITS.marketFacts), competitors },
    profile: { what: items(pr?.what, LIMITS.what), clients: items(pr?.clients, LIMITS.clients), projects: items(pr?.projects, LIMITS.projects) },
    fit, compete, sources,
    leftOut: typeof r.leftOut === "number" && r.leftOut >= 0 ? Math.min(999, Math.floor(r.leftOut)) : 0,
    searches: typeof r.searches === "number" && r.searches >= 0 ? Math.min(MAX_REPORT_SEARCHES, Math.floor(r.searches)) : 0,
    missing: [...new Set(missing)],
    ...(reasonsOf(r.reasons, missing).length > 0 ? { reasons: Object.fromEntries(reasonsOf(r.reasons, missing)) as CompanyReport["reasons"] } : {}),
    generatedAt: typeof r.generatedAt === "string" ? r.generatedAt : "",
  };
}
