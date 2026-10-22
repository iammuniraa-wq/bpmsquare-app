// What may leave for a web search, and what may come back into the chat (docs/design/assistant-smarter.md section 2).
// Pure and client-safe, so the rules are tested without a model or a database.
//
// Going out: a query is allowed only when every word of it comes from something the PERSON wrote in this chat, from the
// name of the account or supplier they have open, or from a short fixed list of research words ("company", "website").
// Anything else -- a phone number, an email, a note, a field value, a quote total -- cannot be in it, so the workspace's
// data has no way to reach the provider through the model. People and contact details are never searched.
//
// Coming back: whatever the web returned is text from strangers. It is cleaned here (tags, links, lines that read like
// instructions) and then handed to the model as data inside <web_result>; assistant.ts additionally switches every tool
// off for the rest of the ask, so nothing the page says can cause a call, a navigation or a write.

export const MAX_QUERY_CHARS = 200;
export const MAX_QUERY_WORDS = 14;
export const MAX_WEB_TEXT_CHARS = 6000;
export const MAX_SOURCES = 8;

/** Objects whose open record is a company, so its name may be searched. A contact's name is a person's and never is. */
export const RESEARCHABLE_OPEN_TYPES: readonly string[] = ["account", "supplier"];

const STOP = new Set([
  "a", "an", "the", "of", "in", "on", "for", "and", "or", "to", "is", "are", "was", "what", "who", "about", "with",
  "from", "by", "at", "as", "how", "does", "do", "its", "their", "this", "that", "it", "has", "have", "any", "me",
]);

// Words that describe the company, not the workspace. Without them the assistant's own example query
// ("Tesla Germany" company website industry headquarters) would be refused.
const GENERIC = new Set([
  "company", "website", "official", "site", "industry", "headquarters", "hq", "news", "latest", "recent", "funding",
  "revenue", "employees", "profile", "overview", "information", "products", "services", "leadership", "ceo",
  "competitors", "competitor", "market", "expansion", "financial", "results", "annual", "report", "founded", "history",
  "location", "locations", "offices", "customers", "partners", "acquisition", "acquisitions", "press", "announcement",
  "certifications", "size", "sector", "business", "group", "subsidiaries", "parent", "stock", "listed", "ownership",
  "address", "country", "city", "established", "details", "key", "facts",
]);

// A person, or a way to reach one. The assistant researches organisations only.
const PERSON_TERMS = new Set([
  "linkedin", "facebook", "instagram", "twitter", "tiktok", "personal", "home", "private", "phone", "mobile", "whatsapp",
  "email", "mail", "salary", "age", "born", "birthday", "married", "wife", "husband", "family", "girlfriend", "boyfriend",
  "dating", "residence",
]);

const EMAIL_RE = /\S+@\S+/;
const PHONE_RE = /(?:\+|\b)\d[\d\s().-]{7,}\d/;

const words = (s: string): string[] => (s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);

export function normalizeQuery(q: string): string {
  return q.replace(/\s+/g, " ").trim();
}

export function sameQuery(a: string, b: string): boolean {
  return normalizeQuery(a).toLowerCase() === normalizeQuery(b).toLowerCase();
}

export type QueryCheck = { ok: true; query: string } | { ok: false; reason: string };

/**
 * @param userTurns   what the person typed in this chat (never the assistant's own turns, never a summary block)
 * @param openCompany the name of the open account or supplier, or null (a contact, a quote or any list page gives null)
 */
export function webQueryAllowed(query: string, userTurns: readonly string[], openCompany: string | null): QueryCheck {
  const q = normalizeQuery(query);
  if (!q) return { ok: false, reason: "The search is empty." };
  if (q.length > MAX_QUERY_CHARS) return { ok: false, reason: "The search is too long." };
  if (EMAIL_RE.test(q) || PHONE_RE.test(q)) return { ok: false, reason: "A search never carries an email address or a phone number." };

  const ws = words(q);
  if (ws.length === 0) return { ok: false, reason: "The search has no words." };
  if (ws.length > MAX_QUERY_WORDS) return { ok: false, reason: "The search is too long." };
  if (ws.some((w) => PERSON_TERMS.has(w))) return { ok: false, reason: "The assistant looks up companies only, never a person or their contact details." };

  const allowed = new Set<string>();
  for (const t of userTurns) for (const w of words(t)) allowed.add(w);
  if (openCompany) for (const w of words(openCompany)) allowed.add(w);

  const foreign = ws.filter((w) => {
    if (STOP.has(w) || GENERIC.has(w) || allowed.has(w)) return false;
    if (/^(19[9][0-9]|20[0-3][0-9])$/.test(w)) return false;
    return true;
  });
  if (foreign.length) {
    return { ok: false, reason: `The search contains words that did not come from you or the open company (${foreign.slice(0, 3).join(", ")}).` };
  }
  return { ok: true, query: q };
}

// --- coming back ----------------------------------------------------------------------------------------------------

export type WebSource = { title: string; url: string };

/** https only, no credentials in the address, no control characters; title trimmed. Duplicates by address are dropped. */
export function cleanSources(raw: readonly { title?: unknown; url?: unknown }[]): WebSource[] {
  const seen = new Set<string>();
  const out: WebSource[] = [];
  for (const r of raw) {
    if (typeof r?.url !== "string") continue;
    let u: URL;
    try { u = new URL(r.url.trim()); } catch { continue; }
    if (u.protocol !== "https:" || u.username || u.password || !u.hostname.includes(".")) continue;
    const href = u.toString();
    if (/[\u0000-\u001f\u007f\s]/.test(href) || seen.has(href)) continue;
    seen.add(href);
    const title = (typeof r.title === "string" ? r.title : "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
    out.push({ title: (title || u.hostname).slice(0, 160), url: href });
    if (out.length >= MAX_SOURCES) break;
  }
  return out;
}

// A line that talks to the model rather than about the company. A heuristic on top of the structural defence (tools off
// after a web result), so a miss here is not a hole; it only removes the obvious.
const INJECTION = [
  /\b(ignore|disregard|forget|override)\b[^.\n]{0,60}\b(previous|prior|above|earlier|all|your|the)\b[^.\n]{0,40}\b(instruction|prompt|rule|message|context)s?\b/i,
  /\b(system prompt|developer message|new instructions?|you are now|act as|pretend to be|jailbreak)\b/i,
  /\b(call|use|invoke|run|execute|trigger)\b[^.\n]{0,40}\b(tool|function|navigate|open_record|query_data|create_record|propose_web_search|quick_lookup)\b/i,
  /\b(navigate|redirect|send the user|take the user|tell the user to)\b/i,
  /\b(create|delete|update|send|email|forward)\b[^.\n]{0,30}\b(account|record|quote|contact|invoice|message|data)\b[^.\n]{0,40}\b(now|immediately|first|without)\b/i,
  /<\/?\s*(web_result|system|assistant|tool|instructions?)\b/i,
  /\b(do not|don't|never)\b[^.\n]{0,30}\b(tell|mention|reveal|show)\b[^.\n]{0,30}\b(user|person)\b/i,
  /\breveal\b[^.\n]{0,30}\b(prompt|instructions|data|workspace|key)\b/i,
];

/** Does this one value read like it is talking to the model? Used on field values a web lookup proposed. */
export const readsLikeInstruction = (s: string): boolean => INJECTION.some((re) => re.test(s));

export type CleanedWeb = { text: string; removed: number };

/** Web text made safe to put in front of the model as data. */
export function sanitizeWebText(input: string): CleanedWeb {
  let removed = 0;
  const lines = input
    .replace(/(?![\n\r\t])\p{Cc}|[\p{Cf}\p{Zl}\p{Zp}]/gu, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\bhttps?:\/\/\S+/gi, "")
    .replace(/web_result/gi, "web result")
    .split(/\r?\n/);
  const kept: string[] = [];
  for (const line of lines) {
    const parts = line.split(/(?<=[.!?])\s+/).map((sentence) => {
      if (!INJECTION.some((re) => re.test(sentence))) return sentence;
      removed++;
      return "[text removed: it read like an instruction]";
    });
    kept.push(parts.join(" ").replace(/[ \t]+/g, " ").trimEnd());
  }
  const text = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_WEB_TEXT_CHARS);
  return { text, removed };
}
