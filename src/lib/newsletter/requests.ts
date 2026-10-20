import { CATEGORIES, isKnownLanguage, type NewsletterCategory } from "./types";
import { REWRITE_TONES, type RewriteTone } from "./ai";

// Request-body parsers for the newsletter routes: pure, so they are tested, and
// strict about what they accept. A tenant is never read from a body (MULTI_TENANT_
// GUARDRAILS.md); the foreign ids that do arrive (a product, a template, a
// newsletter) are verified against the tenant by the route.

export const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

export const MAX_NAME = 120;
export const PAGE_SIZE = 20;

export type ListParams = { q: string; template: boolean; status: "draft" | "ready" | "archived" | null; category: NewsletterCategory | null; page: number; page_size: number };

export function parseListParams(sp: URLSearchParams): ListParams {
  const page = Number.parseInt(sp.get("page") ?? "1", 10);
  const status = sp.get("status");
  const category = sp.get("category");
  return {
    // Letters, digits, spaces and a few separators only: the search goes into a PostgREST filter.
    q: (sp.get("q") ?? "").replace(/[^\p{L}\p{N} _.-]/gu, "").trim().slice(0, 60),
    template: sp.get("template") === "1",
    status: status === "draft" || status === "ready" || status === "archived" ? status : null,
    category: (CATEGORIES as readonly string[]).includes(category ?? "") ? (category as NewsletterCategory) : null,
    page: Number.isFinite(page) && page > 0 ? page : 1,
    page_size: PAGE_SIZE,
  };
}

export type SavePayload = {
  name?: string;
  category?: NewsletterCategory;
  topic?: string | null;
  status?: "draft" | "ready" | "archived";
  is_template?: boolean;
  blocks?: unknown;
  languages?: unknown;
  template_origin_id?: string | null;
  built_in_origin?: string | null;
  custom_data?: Record<string, unknown>;
};

export function parseSave(body: unknown, opts: { creating: boolean }): { ok: true; value: SavePayload } | { ok: false; error: string } {
  if (!isRecord(body)) return { ok: false, error: "Invalid body." };
  const v: SavePayload = {};
  if ("name" in body || opts.creating) {
    const name = text(body.name, MAX_NAME);
    if (!name) return { ok: false, error: "Give the newsletter a name." };
    v.name = name;
  }
  if ("category" in body) {
    if (!(CATEGORIES as readonly string[]).includes(String(body.category))) return { ok: false, error: "Unknown category." };
    v.category = body.category as NewsletterCategory;
  }
  if ("topic" in body) {
    if (body.topic === null || body.topic === "") v.topic = null;
    else if (typeof body.topic === "string" && /^[a-z0-9_]{1,40}$/.test(body.topic)) v.topic = body.topic;
    else return { ok: false, error: "Unknown topic." };
  }
  if ("status" in body) {
    if (body.status !== "draft" && body.status !== "ready" && body.status !== "archived") return { ok: false, error: "Unknown status." };
    v.status = body.status;
  }
  if (opts.creating && body.is_template === true) v.is_template = true;
  if ("blocks" in body) {
    if (!Array.isArray(body.blocks)) return { ok: false, error: "Blocks must be a list." };
    v.blocks = body.blocks;
  } else if (opts.creating) return { ok: false, error: "A newsletter needs its blocks." };
  if ("languages" in body) {
    if (!Array.isArray(body.languages) || body.languages.length === 0) return { ok: false, error: "A newsletter needs its English words." };
    v.languages = body.languages;
  } else if (opts.creating) return { ok: false, error: "A newsletter needs its words." };
  if (opts.creating) {
    v.template_origin_id = isUuid(body.template_origin_id) ? body.template_origin_id : null;
    v.built_in_origin = typeof body.built_in_origin === "string" && /^[a-z0-9-]{1,40}$/.test(body.built_in_origin) ? body.built_in_origin : null;
  }
  if (isRecord(body.custom_data)) v.custom_data = Object.fromEntries(Object.entries(body.custom_data).filter(([k]) => k.startsWith("cf_")));
  return { ok: true, value: v };
}

export function parseRewrite(body: unknown): { ok: true; text: string; tone: RewriteTone; lang: string; field: string } | { ok: false; error: string } {
  if (!isRecord(body)) return { ok: false, error: "Invalid body." };
  const t = typeof body.text === "string" ? body.text.trim().slice(0, 4000) : "";
  if (!t) return { ok: false, error: "There are no words to rewrite." };
  if (!(REWRITE_TONES as readonly string[]).includes(String(body.tone))) return { ok: false, error: "Pick shorter, friendlier or more formal." };
  const lang = isKnownLanguage(body.lang) ? body.lang : "en";
  return { ok: true, text: t, tone: body.tone as RewriteTone, lang, field: text(body.field, 20) };
}

export function parseDraft(body: unknown): { ok: true; brief: string; useProducts: boolean; useCampaigns: boolean; topic: string | null } | { ok: false; error: string } {
  if (!isRecord(body)) return { ok: false, error: "Invalid body." };
  const brief = typeof body.brief === "string" ? body.brief.trim().slice(0, 1500) : "";
  if (brief.length < 10) return { ok: false, error: "Say a little more about this issue (a sentence or two)." };
  return {
    ok: true, brief,
    useProducts: body.use_products !== false, useCampaigns: body.use_campaigns !== false,
    topic: typeof body.topic === "string" && /^[a-z0-9_]{1,40}$/.test(body.topic) ? body.topic : null,
  };
}

export function parseTranslate(body: unknown, source: string): { ok: true; target: string; empty: boolean } | { ok: false; error: string } {
  if (!isRecord(body)) return { ok: false, error: "Invalid body." };
  if (!isKnownLanguage(body.lang)) return { ok: false, error: "Pick a language." };
  if (body.lang === source) return { ok: false, error: "That is the language this newsletter is written in." };
  return { ok: true, target: body.lang, empty: body.mode === "empty" };
}
