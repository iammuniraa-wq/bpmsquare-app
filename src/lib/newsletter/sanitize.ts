import { HEX_COLOR_RE } from "@/lib/standardQuoteTemplateBlocks";
import {
  BLOCK_TYPES, REQUIRED_BLOCKS, TEXT_FIELDS, directionOf, isKnownLanguage,
  type BlockSettings, type BlockType, type LanguageRow, type NewsletterBlock, type ReviewMap, type ReviewState, type TextMap,
} from "./types";

// The one gate for everything that becomes part of a design: a hand edit, AI
// output and a duplicated template all pass through here (mirror of
// sanitizeStandardQuoteBlocks). What comes out can only be a known block type
// with allowlisted settings and plain-text words. No markup is ever stored:
// the renderer is the only place HTML is made, and it escapes every string.

export const MAX_BLOCKS = 40;
const ID_RE = /^[a-z0-9_-]{1,40}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_SCHEMES = new Set(["https:", "http:", "mailto:", "tel:"]);
const TAG_LIKE = /<\/?[a-zA-Z!][^>]*>/g;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** A URL that may appear in an email: https, http, mailto or tel only. Returns the normalised URL or null. */
export function safeUrl(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const v = input.trim();
  if (!v || v.length > 2000 || /[\s<>"'{}]/.test(v)) return null;
  try {
    const u = new URL(v);
    if (!SAFE_SCHEMES.has(u.protocol)) return null;
    if ((u.protocol === "https:" || u.protocol === "http:") && !u.hostname) return null;
    return u.toString();
  } catch {
    return null;
  }
}

export const isHexColor = (v: unknown): v is string => typeof v === "string" && HEX_COLOR_RE.test(v);

/** Storage path of an image a tenant uploaded: <tenantId>/assets/<file>. Anything else is refused, so an external or cross-tenant image can never be in a sent email. */
export function isTenantAssetPath(path: unknown, tenantId: string): path is string {
  return typeof path === "string" && path.startsWith(`${tenantId}/assets/`) && new RegExp(`^${tenantId}/assets/[A-Za-z0-9._-]{1,120}$`).test(path);
}

/** Plain text only: tag-like strings and control characters go, newlines are kept. */
export function cleanText(input: unknown, max: number): string {
  if (typeof input !== "string") return "";
  return input.replace(/\r\n?/g, "\n").replace(CONTROL, "").replace(TAG_LIKE, "").trim().slice(0, max);
}

const FIELD_MAX: Record<string, number> = { text: 4000, p1: 1200, p2: 1200 };
const fieldMax = (field: string): number => FIELD_MAX[field] ?? 300;

const ALIGN = new Set(["left", "center", "right"]);

function cleanSettings(type: BlockType, raw: unknown, tenantId: string): BlockSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: BlockSettings = {};
  const url = (k: string) => { const u = safeUrl(r[k]); if (u) out[k] = u; };
  const align = () => { if (typeof r.align === "string" && ALIGN.has(r.align)) out.align = r.align; };
  const asset = (k: string) => { if (isTenantAssetPath(r[k], tenantId)) out[k] = r[k] as string; };
  switch (type) {
    case "image": asset("path"); url("link"); break;
    case "button": url("url"); align(); break;
    case "product": asset("path"); url("url"); if (typeof r.product_id === "string" && UUID_RE.test(r.product_id)) out.product_id = r.product_id.toLowerCase(); break;
    case "event": url("url"); break;
    case "hero": if (isHexColor(r.background)) out.background = r.background; break;
    case "text": align(); break;
    default: break;
  }
  return out;
}

export function defaultBlockId(type: BlockType, taken: ReadonlySet<string>): string {
  let n = 1;
  while (taken.has(`${type}${n}`)) n++;
  return `${type}${n}`;
}

/**
 * Validates a list of blocks. Unknown types and malformed entries are dropped;
 * header is forced first and footer last; both are always present. Returns the
 * clean list and plain-words notes about anything dropped.
 */
export function sanitizeNewsletterBlocks(input: unknown, tenantId: string): { blocks: NewsletterBlock[]; notes: string[] } {
  const notes: string[] = [];
  const list = Array.isArray(input) ? input.slice(0, MAX_BLOCKS * 2) : [];
  const seen = new Set<string>();
  let header: NewsletterBlock | null = null;
  let footer: NewsletterBlock | null = null;
  const middle: NewsletterBlock[] = [];

  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    if (!(BLOCK_TYPES as readonly string[]).includes(String(o.type))) { notes.push("Dropped a block of an unknown type."); continue; }
    const type = o.type as BlockType;
    if (type === "header" && header) continue;
    if (type === "footer" && footer) continue;
    let id = typeof o.id === "string" && ID_RE.test(o.id) && !seen.has(o.id) ? o.id : defaultBlockId(type, seen);
    if (seen.has(id)) id = defaultBlockId(type, seen);
    seen.add(id);
    const block: NewsletterBlock = {
      id, type,
      visible: REQUIRED_BLOCKS.includes(type) ? true : o.visible !== false,
      settings: cleanSettings(type, o.settings, tenantId),
      ...(REQUIRED_BLOCKS.includes(type) && o.locked !== false ? { locked: true } : {}),
      ...(typeof o.topic_id === "string" && /^[a-z0-9_]{1,40}$/.test(o.topic_id) ? { topic_id: o.topic_id } : {}),
    };
    if (type === "header") header = block;
    else if (type === "footer") footer = block;
    else middle.push(block);
  }

  if (!header) { header = { id: defaultBlockId("header", seen), type: "header", visible: true, locked: true, settings: {} }; seen.add(header.id); notes.push("Added the brand header."); }
  if (!footer) { footer = { id: defaultBlockId("footer", seen), type: "footer", visible: true, locked: true, settings: {} }; seen.add(footer.id); notes.push("Added the footer with the unsubscribe line."); }
  if (middle.length > MAX_BLOCKS - 2) { notes.push(`A design holds at most ${MAX_BLOCKS} blocks; the rest were dropped.`); middle.length = MAX_BLOCKS - 2; }
  return { blocks: [header, ...middle, footer], notes };
}

/** Keeps only fields the block types define, as clean plain text. Words for blocks that no longer exist are dropped. */
export function sanitizeTexts(input: unknown, blocks: readonly NewsletterBlock[]): TextMap {
  const out: TextMap = {};
  const src = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  for (const b of blocks) {
    const row = src[b.id];
    if (!row || typeof row !== "object") continue;
    const clean: Record<string, string> = {};
    for (const f of TEXT_FIELDS[b.type]) {
      const v = (row as Record<string, unknown>)[f];
      if (typeof v === "string") clean[f] = cleanText(v, fieldMax(f));
    }
    out[b.id] = clean;
  }
  return out;
}

const REVIEW_STATES: readonly ReviewState[] = ["written", "translated", "reviewed"];

export function sanitizeReview(input: unknown, blocks: readonly NewsletterBlock[]): ReviewMap {
  const out: ReviewMap = {};
  const src = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  for (const b of blocks) {
    const v = src[b.id];
    if (typeof v === "string" && (REVIEW_STATES as readonly string[]).includes(v)) out[b.id] = v as ReviewState;
  }
  return out;
}

/**
 * Blocks whose words still need a person: translated and not yet reviewed.
 * A language is ready (and sendable) when there are none.
 */
export function pendingBlocks(row: Pick<LanguageRow, "review">, blocks: readonly NewsletterBlock[]): string[] {
  return blocks.filter((b) => b.visible && row.review[b.id] === "translated").map((b) => b.id);
}

export function languageStatus(row: Pick<LanguageRow, "review">, blocks: readonly NewsletterBlock[]): "draft" | "ready" {
  return pendingBlocks(row, blocks).length === 0 ? "ready" : "draft";
}

export function sanitizeLanguageRow(input: unknown, blocks: readonly NewsletterBlock[]): LanguageRow | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;
  if (!isKnownLanguage(o.lang)) return null;
  const review = sanitizeReview(o.review, blocks);
  const row: LanguageRow = {
    lang: o.lang,
    dir: directionOf(o.lang),
    subject: cleanText(o.subject, 200),
    preheader: cleanText(o.preheader, 200),
    texts: sanitizeTexts(o.texts, blocks),
    review,
    status: "draft",
    translated_by: o.translated_by === "ai" ? "ai" : o.translated_by === "person" ? "person" : null,
  };
  row.status = languageStatus(row, blocks);
  return row;
}
