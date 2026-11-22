import { sanitizeWebText } from "@/lib/assistant/webQuery";
import { hostOfUrl, normaliseName, urlOnDomain } from "../companyKey";
import { looksPersonal } from "../subject";
import { cleanText, isStaleOn, looksLikeInstruction, normaliseUrl, parseWhen, type Citation } from "../validate";
import {
  MAX_REPORT_SEARCHES, PROJECT_KINDS, REPORT_MAX_SOURCES, REPORT_SECTIONS,
  type CompanyReport, type ProjectKind, type ReportCompete, type ReportItem, type ReportLeader, type ReportSectionId, type ReportSource,
} from "./types";

// validateReport(): everything the research call says about a company passes through here and nothing else reaches the
// dock (docs/design/company-report.md, "Safety"). Pure and deterministic. A statement is kept only when it has a text that
// reads like a fact, a page the provider itself cited, and an https address; the model's own words are never drawn,
// only these fields. Web text is data: a sentence that reads like an instruction removes the whole statement.

export const LIMITS: Record<ReportSectionId, number> = {
  overview: 3, products: 8, size: 5, leadership: 6, news: 6, projects: 8, strengths: 5, weaknesses: 5, compete: 6,
};
const MAX_TEXT = 320;
const MAX_SIZE_TEXT = 120;

export type ReportDropReason =
  | "not_an_object" | "no_text" | "too_long" | "instruction" | "no_source" | "not_https" | "uncited" | "other_company"
  | "no_date" | "bad_size" | "bad_person" | "unlisted_offering" | "over_cap" | "duplicate" | "no_offerings";

export type ReportValidateCtx = {
  /** The vetted subject: the report is always headed with this name, never with one the model wrote. */
  subject: { name: string; domain: string | null; country: string | null };
  citations: readonly Citation[];
  /** The workspace's own offering names: the only things "How they compete with us" may mention. */
  offerings: readonly string[];
  now: Date;
  searches: number;
};

export type ValidatedReport = { report: CompanyReport; dropped: { reason: ReportDropReason; section: ReportSectionId | "size" | "sources" }[] };

type Rec = Record<string, unknown>;
const asRecord = (v: unknown): Rec | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : null);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : asRecord(v) ? [v] : []);

type Staged = {
  section: ReportSectionId;
  url: string;
  text: string;
  on?: string;
  old?: boolean;
  kind?: ProjectKind;
  leader?: { name: string; title: string };
};

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

export function validateReport(raw: unknown, ctx: ReportValidateCtx): ValidatedReport {
  const dropped: ValidatedReport["dropped"] = [];
  const drop = (reason: ReportDropReason, section: ReportSectionId | "size" | "sources") => { dropped.push({ reason, section }); };
  const root = asRecord(raw) ?? {};

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

  const staged: Staged[] = [];
  const seen = new Set<string>();

  const stageItems = (section: Exclude<ReportSectionId, "compete" | "leadership">, rawList: unknown, o: { needDate?: boolean; max?: number } = {}) => {
    const out: Staged[] = [];
    for (const item of list(rawList)) {
      const r = asRecord(item);
      if (!r) { drop("not_an_object", section); continue; }
      const text = cleanStatement(r.text, o.max ?? MAX_TEXT);
      if (!text.ok) { drop(text.reason, section); continue; }
      const src = checkSource(r.source_url);
      if (!src.ok) { drop(src.reason, section); continue; }
      if (r.about_subject === false) { drop("other_company", section); continue; }
      const on = parseWhen(r.published_on, ctx.now);
      if (o.needDate && !on) { drop("no_date", section); continue; }
      const key = `${section}|${text.text.toLowerCase()}`;
      if (seen.has(key)) { drop("duplicate", section); continue; }
      seen.add(key);
      const kind = typeof r.kind === "string" && (PROJECT_KINDS as readonly string[]).includes(r.kind) ? (r.kind as ProjectKind) : "project";
      out.push({ section, url: src.url, text: text.text, ...(on ? { on, old: isStaleOn(on, ctx.now) } : {}), ...(section === "projects" ? { kind } : {}) });
    }
    if (section === "news") out.sort((a, b) => (b.on ?? "").localeCompare(a.on ?? ""));
    staged.push(...out.slice(0, LIMITS[section]));
  };

  stageItems("overview", root.overview);
  stageItems("products", root.products);
  stageItems("news", root.news, { needDate: true });
  stageItems("projects", root.projects);
  stageItems("strengths", root.strengths);
  stageItems("weaknesses", root.weaknesses);

  // Size and financials: a figure with its date and its page, or nothing. The model never supplies a bare number.
  {
    const out: Staged[] = [];
    for (const item of list(root.size)) {
      const r = asRecord(item);
      if (!r) { drop("not_an_object", "size"); continue; }
      const text = cleanStatement(r.text, MAX_SIZE_TEXT);
      const asOf = parseWhen(r.as_of, ctx.now);
      const src = checkSource(r.source_url);
      if (!text.ok || !/\d/.test(text.text) || !asOf || !src.ok) { drop("bad_size", "size"); continue; }
      if (r.about_subject === false) { drop("other_company", "size"); continue; }
      out.push({ section: "size", url: src.url, text: text.text, on: asOf, old: isStaleOn(asOf, ctx.now) });
    }
    staged.push(...out.slice(0, LIMITS.size));
  }

  // Leadership: a name and a title the company itself publishes, on its own site. No contact detail, no biography.
  {
    const out: Staged[] = [];
    for (const item of list(root.leadership)) {
      const r = asRecord(item);
      const name = cleanText(r?.name);
      const title = cleanText(r?.title);
      const src = checkSource(r?.source_url);
      const clean = !!r && name.length >= 3 && name.length <= 80 && name.split(" ").length <= 6 && title.length >= 2 && title.length <= 80
        && !/[@\d]/.test(name) && !looksPersonal(title) && !/\d{4,}/.test(title) && !looksLikeInstruction(`${name} ${title}`) && !/https?:|www\./i.test(`${name} ${title}`);
      if (!r || !clean || !src.ok || !onOwnSite(src.url, ctx.subject)) { drop("bad_person", "leadership"); continue; }
      if (out.some((x) => x.leader!.name.toLowerCase() === name.toLowerCase())) { drop("duplicate", "leadership"); continue; }
      out.push({ section: "leadership", url: src.url, text: `${name} · ${title}`, leader: { name, title } });
    }
    staged.push(...out.slice(0, LIMITS.leadership));
  }

  // How they compete with us: an inference, so no page is asked for; but it may only name an offering the workspace listed.
  const competeOut: ReportCompete[] = [];
  {
    const byLower = new Map(ctx.offerings.map((o) => [o.toLowerCase(), o]));
    for (const item of list(root.compete)) {
      if (byLower.size === 0) { drop("no_offerings", "compete"); continue; }
      const r = asRecord(item);
      if (!r) { drop("not_an_object", "compete"); continue; }
      const offering = byLower.get(cleanText(r.offering).toLowerCase());
      if (!offering) { drop("unlisted_offering", "compete"); continue; }
      const text = cleanStatement(r.text, MAX_TEXT);
      if (!text.ok) { drop(text.reason, "compete"); continue; }
      if (competeOut.length < LIMITS.compete) competeOut.push({ offering, text: text.text });
    }
  }

  // Keep the pages that back the most statements; a statement whose page falls outside the cap goes with it.
  const usage = new Map<string, { count: number; first: number }>();
  staged.forEach((s, i) => { const u = usage.get(s.url); if (u) u.count++; else usage.set(s.url, { count: 1, first: i }); });
  const kept = new Set([...usage.entries()].sort((a, b) => b[1].count - a[1].count || a[1].first - b[1].first).slice(0, REPORT_MAX_SOURCES).map(([u]) => u));
  const finalStaged = staged.filter((s) => { if (kept.has(s.url)) return true; drop("over_cap", s.section); return false; });

  // Numbered in the order the reader meets them.
  const sources: ReportSource[] = [];
  const numberOf = new Map<string, number>();
  const bySection = new Map<ReportSectionId, Staged[]>();
  for (const id of REPORT_SECTIONS) bySection.set(id, []);
  for (const s of finalStaged) bySection.get(s.section)!.push(s);
  for (const id of REPORT_SECTIONS) {
    for (const s of bySection.get(id)!) {
      if (numberOf.has(s.url)) continue;
      const cite = cites.get(s.url)!;
      const title = cleanText(cite.title).slice(0, 160) || hostOfUrl(s.url) || s.url;
      const n = sources.length + 1;
      numberOf.set(s.url, n);
      sources.push({ n, title, url: s.url, ...(hostOfUrl(s.url) ? { publisher: hostOfUrl(s.url)! } : {}) });
    }
  }

  const items = (id: Exclude<ReportSectionId, "compete" | "leadership">): ReportItem[] =>
    bySection.get(id)!.map((s) => ({ text: s.text, src: numberOf.get(s.url)!, ...(s.on ? { on: s.on } : {}), ...(s.old ? { old: true } : {}), ...(s.kind ? { kind: s.kind } : {}) }));
  const leaders: ReportLeader[] = bySection.get("leadership")!.map((s) => ({ name: s.leader!.name, title: s.leader!.title, src: numberOf.get(s.url)! }));
  const overview = items("overview");
  const firstSentence = overview[0]?.text.split(/(?<=[.!?])\s+/)[0] ?? "";

  const counted = dropped.filter((d) => d.reason !== "duplicate" && d.reason !== "no_offerings" && d.section !== "compete").length;
  const report: CompanyReport = {
    v: 1,
    name: ctx.subject.name, domain: ctx.subject.domain, country: ctx.subject.country,
    summary: firstSentence.length > 160 ? `${firstSentence.slice(0, 159).trimEnd()}…` : firstSentence,
    overview, products: items("products"), size: items("size"), leadership: leaders, news: items("news"), projects: items("projects"),
    strengths: items("strengths"), weaknesses: items("weaknesses"), compete: competeOut,
    sources, leftOut: counted,
    searches: Math.min(Math.max(0, Math.floor(ctx.searches)), MAX_REPORT_SEARCHES),
    generatedAt: ctx.now.toISOString(),
  };
  return { report, dropped };
}

/**
 * A report read back from the cache. The stored value was validated when it was written, but the table is plain jsonb, so
 * the shape is rebuilt here: anything off is dropped and a source that is not https never reaches a link.
 */
export function readStoredReport(raw: unknown): CompanyReport | null {
  const r = asRecord(raw);
  if (!r || r.v !== 1 || typeof r.name !== "string" || !Array.isArray(r.sources)) return null;
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
  const items = (v: unknown, max: number): ReportItem[] => {
    const out: ReportItem[] = [];
    for (const i of Array.isArray(v) ? v : []) {
      const x = asRecord(i);
      if (!x || typeof x.text !== "string" || typeof x.src !== "number" || !known.has(x.src)) continue;
      out.push({
        text: cleanText(x.text).slice(0, MAX_TEXT), src: x.src,
        ...(typeof x.on === "string" && /^\d{4}-\d{2}(-\d{2})?$/.test(x.on) ? { on: x.on } : {}),
        ...(x.old === true ? { old: true } : {}),
        ...(typeof x.kind === "string" && (PROJECT_KINDS as readonly string[]).includes(x.kind) ? { kind: x.kind as ProjectKind } : {}),
      });
      if (out.length >= max) break;
    }
    return out;
  };
  const leaders: ReportLeader[] = [];
  for (const i of Array.isArray(r.leadership) ? r.leadership : []) {
    const x = asRecord(i);
    if (!x || typeof x.name !== "string" || typeof x.title !== "string" || typeof x.src !== "number" || !known.has(x.src)) continue;
    leaders.push({ name: cleanText(x.name).slice(0, 80), title: cleanText(x.title).slice(0, 80), src: x.src });
    if (leaders.length >= LIMITS.leadership) break;
  }
  const compete: ReportCompete[] = [];
  for (const i of Array.isArray(r.compete) ? r.compete : []) {
    const x = asRecord(i);
    if (!x || typeof x.offering !== "string" || typeof x.text !== "string") continue;
    compete.push({ offering: cleanText(x.offering).slice(0, 80), text: cleanText(x.text).slice(0, MAX_TEXT) });
    if (compete.length >= LIMITS.compete) break;
  }
  return {
    v: 1, name: cleanText(r.name).slice(0, 120),
    domain: typeof r.domain === "string" ? r.domain.slice(0, 253) : null, country: typeof r.country === "string" ? cleanText(r.country).slice(0, 60) : null,
    summary: cleanText(r.summary).slice(0, 170),
    overview: items(r.overview, LIMITS.overview), products: items(r.products, LIMITS.products), size: items(r.size, LIMITS.size),
    leadership: leaders, news: items(r.news, LIMITS.news), projects: items(r.projects, LIMITS.projects),
    strengths: items(r.strengths, LIMITS.strengths), weaknesses: items(r.weaknesses, LIMITS.weaknesses), compete,
    sources, leftOut: typeof r.leftOut === "number" && r.leftOut >= 0 ? Math.min(999, Math.floor(r.leftOut)) : 0,
    searches: typeof r.searches === "number" && r.searches >= 0 ? Math.min(MAX_REPORT_SEARCHES, Math.floor(r.searches)) : 0,
    generatedAt: typeof r.generatedAt === "string" ? r.generatedAt : "",
  };
}
