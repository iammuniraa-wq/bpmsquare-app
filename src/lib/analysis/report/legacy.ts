// The company report as it was stored before the brief (version 1). Cached rows in this shape stay readable for the seven
// days they live: the card draws them as they are, with a line saying the format is older, and they never count as fresh, so
// the next ask offers the new brief. No migration. Client-safe and dependency-free apart from the text cleaner.

import { cleanText } from "../validate";
import type { ReportSource } from "./types";

export const LEGACY_SECTIONS = ["overview", "products", "size", "leadership", "news", "projects", "strengths", "weaknesses", "compete"] as const;
export type LegacySectionId = (typeof LEGACY_SECTIONS)[number];

export const LEGACY_SECTION_LABEL: Record<LegacySectionId, string> = {
  overview: "Overview",
  products: "Products and services",
  size: "Size and financials",
  leadership: "Leadership",
  news: "Recent news",
  projects: "Projects and clients",
  strengths: "Strengths",
  weaknesses: "Weaknesses",
  compete: "How they compete with us",
};

const PROJECT_KINDS = ["project", "client", "award", "tender"] as const;
type ProjectKind = (typeof PROJECT_KINDS)[number];

export type LegacyItem = { text: string; src: number; on?: string; old?: boolean; kind?: ProjectKind };
export type LegacyLeader = { name: string; title: string; src: number };
export type LegacyCompete = { offering: string; text: string };

export type LegacyReport = {
  v: 1;
  name: string;
  domain: string | null;
  country: string | null;
  summary: string;
  overview: LegacyItem[];
  products: LegacyItem[];
  size: LegacyItem[];
  leadership: LegacyLeader[];
  news: LegacyItem[];
  projects: LegacyItem[];
  strengths: LegacyItem[];
  weaknesses: LegacyItem[];
  compete: LegacyCompete[];
  sources: ReportSource[];
  leftOut: number;
  searches: number;
  generatedAt: string;
};

type Rec = Record<string, unknown>;
const asRecord = (v: unknown): Rec | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : null);

const LIMITS = { overview: 3, products: 8, size: 5, leadership: 6, news: 6, projects: 8, strengths: 5, weaknesses: 5, compete: 6 } as const;
const MAX_TEXT = 320;

/** True when the legacy report holds nothing a person could read. */
export const legacyIsEmpty = (r: LegacyReport): boolean =>
  r.overview.length + r.products.length + r.size.length + r.leadership.length + r.news.length + r.projects.length + r.strengths.length + r.weaknesses.length === 0;

export const legacySectionCount = (r: LegacyReport, id: LegacySectionId): number => (r[id] as unknown[]).length;

/**
 * A version 1 report read back from the cache. The table is plain jsonb, so the shape is rebuilt here: anything off is
 * dropped and a source that is not https never reaches a link.
 */
export function readLegacyReport(raw: unknown): LegacyReport | null {
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
  const items = (v: unknown, max: number): LegacyItem[] => {
    const out: LegacyItem[] = [];
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
  const leaders: LegacyLeader[] = [];
  for (const i of Array.isArray(r.leadership) ? r.leadership : []) {
    const x = asRecord(i);
    if (!x || typeof x.name !== "string" || typeof x.title !== "string" || typeof x.src !== "number" || !known.has(x.src)) continue;
    leaders.push({ name: cleanText(x.name).slice(0, 80), title: cleanText(x.title).slice(0, 80), src: x.src });
    if (leaders.length >= LIMITS.leadership) break;
  }
  const compete: LegacyCompete[] = [];
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
    searches: typeof r.searches === "number" && r.searches >= 0 ? Math.min(12, Math.floor(r.searches)) : 0,
    generatedAt: typeof r.generatedAt === "string" ? r.generatedAt : "",
  };
}

/** The line shown above an older report. */
export const LEGACY_NOTICE = "This is an older report format. Refresh to get the new brief.";
