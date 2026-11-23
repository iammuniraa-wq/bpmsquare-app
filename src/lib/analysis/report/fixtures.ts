import type { Citation } from "../validate";
import { validateBrief, type PartsRaw, type ReportValidateCtx } from "./validate";
import type { CompanyReport } from "./types";

// Test fixtures for the company brief: a fictional listed contractor (the mock-up's company), the four parts' answers as the
// provider could return them, and the pages the provider would have cited. Only tests import this file.

export const NOW = new Date("2026-11-23T12:00:00Z");

export const SITE = "https://halcyon-gulf.example/about";
export const ANNUAL = "https://halcyon-gulf.example/investors/annual-report-2025";
export const TEAM = "https://halcyon-gulf.example/leadership";
export const CAREERS = "https://halcyon-gulf.example/careers";
export const YARD = "https://halcyon-gulf.example/news/second-yard";
export const AWARD = "https://gulfmarket-news.example/jubail-award";
export const EXCHANGE = "https://www.saudiexchange.sa/announcement/cfo-appointed";
export const OUTLOOK = "https://regionwatch.example/outlook-2026";
export const RATING = "https://ratingsdesk.example/halcyon";

export const SUBJECT = { name: "Halcyon Gulf Infrastructure Co.", domain: "halcyon-gulf.example", country: "Saudi Arabia" };

export const CITATIONS: Citation[] = [
  { url: SITE, title: "Halcyon Gulf: About us", snippets: ["Halcyon Gulf builds roads, utilities and precast housing for government clients in the Eastern Province, headquartered in Dammam."] },
  { url: ANNUAL, title: "Annual report FY2025", snippets: ["Revenue for FY2025 was SAR 2.84 billion, up from SAR 2.53 billion. Net profit was SAR 186 million. Order backlog stood at SAR 6.1 billion. We employed about 4,200 people."] },
  { url: TEAM, title: "Leadership team", snippets: ["Halcyon Gulf leadership: Rania Al-Mansouri, Chief Procurement Officer; Tariq Haddad, Director of Projects; Hamad Al-Qurashi, Chief Executive Officer."] },
  { url: CAREERS, title: "Careers: open roles" },
  { url: YARD, title: "Second precast yard opens" },
  { url: AWARD, title: "Contract award announcement, Jubail" },
  { url: EXCHANGE, title: "Halcyon Gulf Infrastructure Co. appoints Chief Financial Officer", snippets: ["Halcyon Gulf Infrastructure Co. announces the appointment of Lena Voss as Chief Financial Officer."] },
  { url: OUTLOOK, title: "Regional construction outlook 2026" },
  { url: RATING, title: "Credit rating action" },
];

const fig = (amount: number, unit: string, year: number, url = ANNUAL) => ({ amount, unit, currency: "SAR", fiscal_year: year, source_url: url });

export function goodParts(): PartsRaw {
  return {
    financials: {
      revenue: [fig(2.84, "billion", 2025), fig(2.53, "billion", 2024), fig(2.21, "billion", 2023)],
      profit: [fig(186, "million", 2025), fig(171, "million", 2024)],
      highlights: [{ text: "Order backlog of SAR 6.1 bn at the end of FY2025.", published_on: "2026-03", source_url: ANNUAL }],
      market: [{ text: "Among the five largest listed contractors in the Eastern Province by revenue.", source_url: OUTLOOK }],
      tailwinds: [{ text: "Government infrastructure spending programme continues.", source_url: OUTLOOK }],
      headwinds: [{ text: "Management cites higher material costs in the FY2025 results.", source_url: ANNUAL }],
      proxies: [],
    },
    signals: {
      signals: [
        { kind: "award", text: "Awarded the SAR 410 m Jubail road and utilities package.", published_on: "2026-11-12", why: "A new site needs materials and plant within two quarters.", source_url: AWARD },
        { kind: "plant", text: "Opens a second precast yard in Dammam Industrial City.", published_on: "2026-09-29", why: "More volume through one yard, so supply planning is under pressure.", source_url: YARD },
        { kind: "leadership", text: "Appoints a new Chief Financial Officer.", published_on: "2026-06-22", why: "Payment terms and supplier onboarding may be reviewed.", source_url: EXCHANGE },
      ],
    },
    people: {
      roles: [
        { function: "procurement", talk_about: "Materials and plant for the Jubail package.", named: [{ name: "Rania Al-Mansouri", title: "Chief Procurement Officer", source_url: TEAM }] },
        { function: "projects", talk_about: "Mobilisation dates for Jubail and the yard fit-out.", named: [{ name: "Tariq Haddad", title: "Director of Projects", source_url: TEAM }] },
        { function: "operations", talk_about: "Yard output and equipment uptime.", named: [] },
        { function: "finance", talk_about: "Payment terms and supplier onboarding.", named: [{ name: "Lena Voss", title: "Chief Financial Officer", source_url: EXCHANGE }] },
        { function: "executive", talk_about: "Open at project level first.", named: [{ name: "Hamad Al-Qurashi", title: "Chief Executive Officer", source_url: TEAM }] },
      ],
      hiring: [{ text: "Advertises 9 procurement and planning roles on its careers page.", published_on: "2026-09-14", why: "The buying team is being built now.", source_url: CAREERS }],
    },
    market: {
      one_liner: { text: "Builds roads, utilities and precast housing for government clients in the Eastern Province.", source_url: SITE },
      hq: { value: "Dammam, Saudi Arabia", source_url: SITE },
      ownership: { kind: "public", detail: "Main market", source_url: ANNUAL },
      employees: { count: 4200, approx: true, as_of: "2025-12", source_url: ANNUAL },
      ticker: "4999",
      what: [{ text: "Roads, utilities and precast housing.", source_url: SITE }],
      clients: [{ text: "Two ministries and a state utility.", source_url: SITE }],
      projects: [{ text: "Jubail package, Dammam yard, Khobar drainage.", source_url: AWARD }],
      market_facts: [{ text: "Public works spending is concentrated in a few large packages a year.", source_url: OUTLOOK }],
      competitors: [{ name: "Dunemark Contracting", how: "Larger civil works contractor, strong in roads.", source_url: OUTLOOK }],
      watchouts: [{ kind: "rating", text: "Credit rating affirmed at BBB- with a negative outlook.", published_on: "2026-06", source_url: RATING }],
    },
  };
}

export const ctx = (over: Partial<ReportValidateCtx> = {}): ReportValidateCtx => ({
  subject: SUBJECT, citations: CITATIONS, now: NOW, searches: 12, ...over,
});

/** The Fit call's answer for the fixture, as the model could write it. */
export const goodFit = () => ({
  angle: "Offer to support the Jubail start-up with supply scheduling in the first weeks.",
  priorities: [
    { based_on: "S1", offering: "Project supply", why: "Site supply and logistics for the Jubail package." },
    { based_on: "S2", offering: "Precast supply", why: "Yard throughput under pressure at the Dammam yard." },
  ],
  questions: [
    "Who decides the supplier list for the Jubail package?",
    "How are materials planned across the two yards today?",
    "What changes for suppliers with the new procurement team?",
  ],
});

/** The validated brief for the fixture company. */
export const validateBriefFor = (parts: PartsRaw = goodParts(), over: Partial<ReportValidateCtx> = {}): CompanyReport => validateBrief(parts, ctx(over)).report;
