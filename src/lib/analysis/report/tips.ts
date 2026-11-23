import { DEFAULT_REPORT_DAILY_LIMIT, REFRESH_MIN_MINUTES } from "../budget";
import { TTL_DAYS } from "../types";
import { MAX_REPORT_SEARCHES } from "./types";

// The explanations the company brief keeps behind an "i" (bpmsquarecore 6b). One place, so a test can hold every text to
// the InfoTip limit (two sentences, 160 characters). The card prints none of these as running text.

export const REPORT_TIPS = {
  searches: `A brief runs up to ${MAX_REPORT_SEARCHES} web searches in four parts and uses part of this month's AI allowance. It is reused for ${TTL_DAYS} days.`,
  refresh: `A saved brief is reused for ${TTL_DAYS} days. You can refresh one every ${REFRESH_MIN_MINUTES} minutes, and make ${DEFAULT_REPORT_DAILY_LIMIT} a day.`,
  history: "From your own workspace, read when you open this page. It is never sent to the web and never saved with the brief.",
  whyNow: "Dated events from public pages, newest first. The Why it matters lines are the assistant's reading, not from a page.",
  who: "Functions come from a fixed list. Only names and titles the company publishes are shown, and no contact details are collected.",
  fit: "Built from the facts in this brief and the names of what your workspace sells. It is the assistant's reading, not from a page.",
  performance: "Figures are as published, with year and currency. Growth and margin are worked out by the app from two sourced figures.",
  check: "The figure's digits were not found in the page text the search returned. Open the source and read it there.",
  watchouts: "Credit, payment, legal and reputation items, each dated. Empty means none found in the searches run.",
  market: "Market facts and the organisations the company competes with, each from a page.",
  profile: "Background from the company's own pages: what it does, who it works for and what it has built.",
  notPublished: "Many private companies publish no turnover. The app shows what it found instead and never estimates a figure.",
  sources: "Every statement above comes from a page the search returned, except the labelled readings.",
  inference: "This is the assistant's own reading of the facts. It is not from a web page.",
  parts: "Four parts run at the same time and usually take 1 to 3 minutes. You can keep working; the card fills in when they finish.",
} as const;
