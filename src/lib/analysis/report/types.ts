// The company report: the one shape the validator produces, the cache stores and the dock draws
// (docs/design/company-report.md). Client-safe and dependency-free. Every statement carries `src`, the number of
// its source in `sources`; the one exception is `compete`, which is the assistant's own inference and is labelled so.

export const REPORT_SECTIONS = ["overview", "products", "size", "leadership", "news", "projects", "strengths", "weaknesses", "compete"] as const;
export type ReportSectionId = (typeof REPORT_SECTIONS)[number];

export const REPORT_SECTION_LABEL: Record<ReportSectionId, string> = {
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

export const PROJECT_KINDS = ["project", "client", "award", "tender"] as const;
export type ProjectKind = (typeof PROJECT_KINDS)[number];

/** One checked statement. `on` is a publication date or "as of" month (YYYY-MM-DD or YYYY-MM), when the page gave one. */
export type ReportItem = { text: string; src: number; on?: string; old?: boolean; kind?: ProjectKind };

/** A title the company itself publishes. Name, title and the page; nothing else about the person is ever kept. */
export type ReportLeader = { name: string; title: string; src: number };

/** The assistant's own reading of how this company competes with one of the workspace's offerings. Never sourced, always labelled. */
export type ReportCompete = { offering: string; text: string };

export type ReportSource = { n: number; title: string; url: string; publisher?: string };

export type CompanyReport = {
  v: 1;
  name: string;
  domain: string | null;
  country: string | null;
  /** The first sentence of the overview, shown under the name. Empty when there is no overview. */
  summary: string;
  overview: ReportItem[];
  products: ReportItem[];
  size: ReportItem[];
  leadership: ReportLeader[];
  news: ReportItem[];
  projects: ReportItem[];
  strengths: ReportItem[];
  weaknesses: ReportItem[];
  compete: ReportCompete[];
  sources: ReportSource[];
  /** How many statements were left out because no cited page backed them. Shown as one muted line. */
  leftOut: number;
  /** The searches the provider ran for this report. */
  searches: number;
  generatedAt: string;
};

/** True when no page backed any statement: there is nothing a person could read. The inference section does not count. */
export const reportIsEmpty = (r: CompanyReport): boolean =>
  r.overview.length + r.products.length + r.size.length + r.leadership.length + r.news.length + r.projects.length
    + r.strengths.length + r.weaknesses.length === 0;

/** How many statements a section holds, for the collapsed header. */
export function sectionCount(r: CompanyReport, id: ReportSectionId): number {
  return (r[id] as unknown[]).length;
}

/** The text of the source with this number, or undefined. */
export const sourceOf = (r: CompanyReport, n: number): ReportSource | undefined => r.sources.find((s) => s.n === n);

/** The most searches one report may run. The consent chip and the InfoTip both quote this number. */
export const MAX_REPORT_SEARCHES = 7;
/** Sources one report keeps (the analysis keeps 8; a report has eight sections to back). */
export const REPORT_MAX_SOURCES = 12;
