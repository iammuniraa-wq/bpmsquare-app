import { DEFAULT_REPORT_DAILY_LIMIT, REFRESH_MIN_MINUTES } from "../budget";
import { TTL_DAYS } from "../types";
import { MAX_REPORT_SEARCHES } from "./types";

// The explanations the company report keeps behind an "i" (bpmsquarecore 6b). One place, so a test can hold every text to
// the InfoTip limit (two sentences, 160 characters). The card and the question print none of these as running text.
// The dock keeps at most three "i" for its own chrome (assistant/tips.ts); these belong to the report card the owner asked
// to explain its search cost and its one inferred section (docs/design/company-report.md).

export const REPORT_TIPS = {
  searches: `A report runs up to ${MAX_REPORT_SEARCHES} web searches and counts as one of your daily searches. It also uses more of the monthly AI allowance.`,
  inference: "This part is the assistant's own reading, built only from the subjects your workspace sells. It is not from a web page.",
  sources: "Every statement above comes from a page the search returned. Leadership shows only titles a company publishes itself.",
  refresh: `A saved report is reused for ${TTL_DAYS} days. You can refresh one every ${REFRESH_MIN_MINUTES} minutes, and make ${DEFAULT_REPORT_DAILY_LIMIT} a day.`,
} as const;
