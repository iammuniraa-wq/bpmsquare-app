import { mentionsFullName, urlOnDomain, hostOfUrl } from "./companyKey";
import { CLAIM_KINDS, STALE_DAYS, type Claim, type ClaimKind, type PublicPerson, type SourceRef, type SourcedValue } from "./types";

// validateResearch(): everything the web research call says passes through here and nothing else gets onto the card
// (docs/design/account-analysis.md section 7). Pure and deterministic. Web text is data: it is checked, trimmed,
// matched to the subject and either attached, parked in "Check these" or dropped. It never decides an action.

const DAY = 86_400_000;
export const MAX_TEXT = 300;
export const MAX_DOING = 3;
export const MAX_HAPPENING = 6;
export const MAX_CHECK = 6;
export const MAX_PEOPLE = 5;

/** A page the research call actually cited (from the response's own citation blocks), or the company page we fetched. */
export type Citation = { url: string; title?: string; snippet?: string };

export type Subject = { name: string; domain: string | null; city?: string | null; country?: string | null };

export type TopicRule = { name: string; keywords?: string[] };

export type ValidateCtx = {
  subject: Subject;
  citations: Citation[];
  topics: TopicRule[];
  now: Date;
};

export type DropReason = "not_an_object" | "no_text" | "too_long" | "no_source" | "not_https" | "uncited" | "other_company" | "bad_person" | "bad_size" | "duplicate";

export type ValidatedResearch = {
  doing: Claim[];
  happening: Claim[];
  checkThese: Claim[];
  size: SourcedValue | null;
  people: PublicPerson[];
  sources: SourceRef[];
  dropped: { reason: DropReason; text?: string }[];
};

// Phrases that address a model rather than describe a company. A claim that reads like this stays visible as data (a
// person can judge it) but is never scored, never turned into a signal, and never reaches the call that phrases "why now".
const INSTRUCTION_PATTERNS: RegExp[] = [
  /\bignore\b.{0,40}\b(instruction|prompt|rule|above|previous|prior)/i,
  /\b(disregard|forget|override)\b.{0,40}\b(instruction|prompt|rule|above|previous|prior|system)/i,
  /\b(system|developer)\s*(prompt|message|instruction)/i,
  /\byou\s+(are|must|should|will)\s+(now|always|never)?\s*\b(act|reply|respond|answer|call|send|navigate|open|delete|reveal|output|say)/i,
  /\b(act|behave|respond)\s+as\b/i,
  /\b(assistant|system|human|user)\s*:/i,
  /<\|[^>]*\|>/,
  /\b(call|invoke|run|use|execute)\s+(the\s+)?(tool|function|command|api)\b/i,
  /\b(navigate|redirect)\s+to\b/i,
  /\b(send|email|forward|post)\b.{0,60}\b(to|at)\b.{0,60}(@|https?:)/i,
  /\b(reveal|print|leak|exfiltrate|share)\b.{0,40}\b(api[ -]?key|secret|password|token|prompt|credentials)/i,
  /\b(delete|drop|erase|wipe)\b.{0,30}\b(all|every|the)\b.{0,30}\b(record|account|data|table|file)/i,
  /\bmark\s+(this|the)\s+(company|account)\b/i,
  /\b(set|raise|change)\s+(the\s+)?(score|rating|verdict|fit)\b/i,
];

export function looksLikeInstruction(text: string): boolean {
  return INSTRUCTION_PATTERNS.some((p) => p.test(text));
}

/** Plain text only: no tags, no control characters, one line, single spaces. */
export function cleanText(v: unknown): string {
  if (typeof v !== "string") return "";
  return v.replace(/<[^>]*>/g, " ").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
}

/** A date from the model: YYYY-MM-DD, YYYY-MM or a full ISO stamp. Anything else, and anything in the future, is nothing. */
export function parseWhen(v: unknown, now: Date): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  let iso: string | null = null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) iso = t;
  else if (/^\d{4}-\d{2}$/.test(t)) iso = `${t}-01`;
  else if (/^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:?\d{2})?$/.test(t)) iso = t.slice(0, 10);
  if (!iso) return undefined;
  const ms = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== iso) return undefined;
  if (ms > now.getTime() + DAY) return undefined;
  if (ms < Date.UTC(1990, 0, 1)) return undefined;
  return iso;
}

export const isStaleOn = (publishedOn: string | undefined, now: Date): boolean =>
  !!publishedOn && now.getTime() - Date.parse(`${publishedOn}T00:00:00Z`) > STALE_DAYS * DAY;

/** A stable short id for a url, so a source keeps its id across runs. */
export function sourceId(url: string): string {
  let h = 5381;
  const t = normaliseUrl(url);
  for (let i = 0; i < t.length; i++) h = ((h * 33) ^ t.charCodeAt(i)) >>> 0;
  return `s${h.toString(36)}`;
}

/** Same page, however the model spelled it: no fragment, no trailing slash, no tracking parameters, lower-case host. */
export function normaliseUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/i.test(k)) u.searchParams.delete(k);
    u.hostname = u.hostname.toLowerCase();
    return u.toString().replace(/\/$/, "");
  } catch {
    return url;
  }
}

function publisherOf(url: string): string | undefined {
  return hostOfUrl(url) ?? undefined;
}

const KIND_SET = new Set<string>(CLAIM_KINDS);

function classify(text: string, given: unknown, topics: TopicRule[]): string | undefined {
  // The model may only choose a name from the tenant's own list; a made-up topic is ignored and the keywords decide.
  if (typeof given === "string") {
    const hit = topics.find((t) => t.name.toLowerCase() === given.trim().toLowerCase());
    if (hit) return hit.name;
  }
  const hay = text.toLowerCase();
  for (const t of topics) {
    const words = [t.name, ...(t.keywords ?? [])].map((w) => w.trim().toLowerCase()).filter((w) => w.length >= 3);
    if (words.some((w) => hay.includes(w))) return t.name;
  }
  return undefined;
}

const asRecord = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

export function validateResearch(raw: unknown, ctx: ValidateCtx): ValidatedResearch {
  const out: ValidatedResearch = { doing: [], happening: [], checkThese: [], size: null, people: [], sources: [], dropped: [] };
  const root = asRecord(raw);
  if (!root) return out;

  const cites = new Map<string, Citation>();
  for (const c of ctx.citations) {
    if (typeof c?.url !== "string") continue;
    try {
      if (new URL(c.url).protocol !== "https:") continue;
    } catch {
      continue;
    }
    cites.set(normaliseUrl(c.url), c);
  }
  const fetchedAt = ctx.now.toISOString();
  const used = new Map<string, SourceRef>();
  const sourceFor = (url: string): SourceRef | null => {
    const key = normaliseUrl(url);
    const cite = cites.get(key);
    if (!cite) return null;
    const existing = used.get(key);
    if (existing) return existing;
    const ref: SourceRef = { id: sourceId(key), url: key, title: cleanText(cite.title) || publisherOf(key) || key, publisher: publisherOf(key), fetchedAt };
    used.set(key, ref);
    return ref;
  };
  const reasonFor = (urlRaw: unknown): "no_source" | "not_https" | "uncited" | null => {
    if (typeof urlRaw !== "string" || !urlRaw.trim()) return "no_source";
    try {
      if (new URL(urlRaw.trim()).protocol !== "https:") return "not_https";
    } catch {
      return "no_source";
    }
    return cites.has(normaliseUrl(urlRaw.trim())) ? null : "uncited";
  };

  const rawClaims = Array.isArray(root.claims) ? root.claims : [];
  const seen = new Set<string>();
  for (const item of rawClaims) {
    const c = asRecord(item);
    if (!c) { out.dropped.push({ reason: "not_an_object" }); continue; }
    const rawText = cleanText(c.text);
    if (!rawText) { out.dropped.push({ reason: "no_text" }); continue; }
    if (rawText.length > MAX_TEXT) { out.dropped.push({ reason: "too_long", text: rawText.slice(0, 40) }); continue; }
    const bad = reasonFor(c.source_url);
    if (bad) { out.dropped.push({ reason: bad, text: rawText.slice(0, 40) }); continue; }
    const source = sourceFor(c.source_url as string)!;
    const cite = cites.get(source.url)!;

    const kind: ClaimKind = typeof c.kind === "string" && KIND_SET.has(c.kind) ? (c.kind as ClaimKind) : "other";
    const key = `${source.url}|${kind}`;
    if (seen.has(key)) { out.dropped.push({ reason: "duplicate", text: rawText.slice(0, 40) }); continue; }

    // Is this about the subject? The model's own flag is not enough: the company's domain, or its whole name as words, must show up.
    const evidence = urlOnDomain(source.url, ctx.subject.domain) || mentionsFullName(`${cite.title ?? ""} ${cite.snippet ?? ""} ${rawText}`, ctx.subject.name);
    const aboutSubject = c.about_subject !== false;
    if (!aboutSubject && !evidence) { out.dropped.push({ reason: "other_company", text: rawText.slice(0, 40) }); continue; }
    seen.add(key);

    const publishedOn = parseWhen(c.published_on, ctx.now);
    const instructionLike = looksLikeInstruction(rawText) || looksLikeInstruction(source.title);
    const attached = aboutSubject && evidence;
    const claim: Claim = {
      text: rawText, kind, source, confidence: attached && c.confidence !== "unsure" && !instructionLike ? "found" : "unsure",
      stale: isStaleOn(publishedOn, ctx.now),
      ...(publishedOn ? { publishedOn } : {}),
      ...(instructionLike ? { instructionLike: true } : {}),
    };
    const topic = classify(rawText, c.topic, ctx.topics);
    if (topic) claim.topic = topic;
    if (kind === "tender") claim.tenderRole = c.tender_role === "issuer" ? "issuer" : "named";

    if (!attached) out.checkThese.push(claim);
    else if (kind === "profile") out.doing.push(claim);
    else out.happening.push(claim);
  }

  const byDateDesc = (a: Claim, b: Claim) => (b.publishedOn ?? "").localeCompare(a.publishedOn ?? "") || a.source.url.localeCompare(b.source.url);
  out.happening.sort(byDateDesc);
  out.doing = out.doing.slice(0, MAX_DOING);
  out.happening = out.happening.slice(0, MAX_HAPPENING);
  out.checkThese = out.checkThese.sort(byDateDesc).slice(0, MAX_CHECK);

  // A size is a number with a source and a date, or nothing. The model never supplies a bare figure.
  const sz = asRecord(root.size);
  if (sz) {
    const value = cleanText(sz.text);
    const asOf = parseWhen(sz.as_of, ctx.now);
    const bad = reasonFor(sz.source_url);
    if (value && value.length <= 80 && /\d/.test(value) && asOf && !bad && !looksLikeInstruction(value)) {
      out.size = { value, source: sourceFor(sz.source_url as string)!, asOf };
    } else {
      out.dropped.push({ reason: "bad_size", text: value.slice(0, 40) });
    }
  }

  // Public leadership: a name and a title the company itself published, on its own domain. Organisation level only.
  const people = Array.isArray(root.people) ? root.people : [];
  for (const p of people) {
    const r = asRecord(p);
    const name = cleanText(r?.name);
    const title = cleanText(r?.title);
    const bad = reasonFor(r?.source_url);
    const ok = !!r && name.length >= 3 && name.length <= 80 && title.length >= 2 && title.length <= 80
      && !/[@\d]/.test(name) && !/[@]|\d{5,}/.test(title) && !looksLikeInstruction(`${name} ${title}`)
      && !bad && urlOnDomain(r.source_url as string, ctx.subject.domain);
    if (!ok) { out.dropped.push({ reason: "bad_person" }); continue; }
    if (out.people.length < MAX_PEOPLE && !out.people.some((x) => x.name.toLowerCase() === name.toLowerCase())) {
      out.people.push({ name, title, source: sourceFor(r!.source_url as string)! });
    }
  }

  const refs = new Map<string, SourceRef>();
  for (const c of [...out.doing, ...out.happening, ...out.checkThese]) refs.set(c.source.url, c.source);
  if (out.size) refs.set(out.size.source.url, out.size.source);
  for (const p of out.people) refs.set(p.source.url, p.source);
  out.sources = [...refs.values()].sort((a, b) => a.url.localeCompare(b.url));
  return out;
}
