import type { TenantConfig } from "@/lib/constants";

// The ⌘K side of the company report (docs/design/company-report.md section 7). The palette stays a launcher: a phrase that
// starts with a research word shows one "Ask the assistant" row, and choosing it hands a prepared question to the dock
// (askDock), which owns the consent chip, the research and the card. Pure and client-safe; the server decides again.

export type ReportPhrase = { subject: string; question: string };

// Leading words that mean "tell me about this company". Each pattern captures the company after them.
const PATTERNS: RegExp[] = [
  /^analy[sz]e\s+(?:the\s+)?(?:company\s+)?(.+)$/i,
  /^research\s+(?:on\s+|into\s+)?(.+)$/i,
  /^competitor(?:\s+(?:analysis|report|profile|research))?\s*(?:on|of|for|:)?\s+(.+)$/i,
  /^company\s+report\s*(?:on|for|of|:)?\s+(.+)$/i,
  /^background\s+on\s+(.+)$/i,
];

const MAX_SUBJECT = 120;

/**
 * The company a research phrase is about, and the question the dock is asked, or null when the text is not such a phrase.
 * A pasted paragraph, an e-mail address or a phone number is never a company name.
 */
export function reportPhrase(text: string): ReportPhrase | null {
  const t = text.trim();
  if (!t || t.length > MAX_SUBJECT + 40 || /[\n\r]/.test(t)) return null;
  for (const re of PATTERNS) {
    const m = re.exec(t);
    if (!m) continue;
    const subject = m[1].replace(/[?!.]+$/, "").replace(/\s+/g, " ").trim();
    if (subject.length < 2 || subject.length > MAX_SUBJECT) return null;
    if (/@/.test(subject) || /\d[\d\s().-]{6,}\d/.test(subject)) return null;
    return { subject, question: `Company report on ${subject}` };
  }
  return null;
}

/**
 * Whether the palette may offer the row. The same gate as the dock: the assistant and its web research on for the workspace,
 * the workspace not blocking outside calls, and the Accounts module the report hangs off. The server decides again on every call.
 */
export function canOfferReportRow(i: {
  features: Record<string, boolean | undefined> | null | undefined;
  config: Partial<TenantConfig> | null | undefined;
  viewable: "all" | readonly string[];
}): boolean {
  const f = i.features;
  if (f?.ai_assistant !== true || f?.ai_assistant_web !== true || f?.accounts !== true) return false;
  if (i.config?.ai_assistant?.block_external_calls === true) return false;
  return i.viewable === "all" || i.viewable.includes("accounts");
}
