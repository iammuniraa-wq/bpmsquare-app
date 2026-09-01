/**
 * Case Query — the deterministic fast-path behind Cases' "ask, don't
 * filter" bar (Nova redesign ported from Quotations, 2026-09-01). Same
 * two-layer shape as lib/quoteQuery.ts: parseCaseQuery(text) turns free
 * text into tokens once, on commit; everything downstream (removing a
 * token, filtering List's rows, filtering Lanes'/Field's server queries)
 * runs on CaseFilter, a plain structured object serialised as ordinary
 * query params, so List/Lanes/Field all resolve the SAME filter from the
 * SAME URL params rather than three independent readings of a sentence.
 *
 * The vocabulary is deliberately narrower than quotes' -- Cases have no
 * value field, no priority, no configurable status list, and (see
 * types.ts: ServiceCase) no updated_at at all, only intake_at and
 * closed_at. "Age" here means days since intake, not days since last
 * touched -- there is no touch-tracking signal to use instead, so the
 * bar is worded "opened over N days ago" rather than "idle" or "no
 * movement", which would falsely imply a staleness signal this schema
 * doesn't have. "stuck"/"a month" map to 30 days specifically to match
 * the one SLA-flavoured heuristic that already exists in this codebase
 * (src/lib/nova/flows.ts's Stream dashboard card), not an invented number.
 */

export type CaseToken =
  | { kind: "status"; value: string; label: string }
  | { kind: "type"; value: "amc" | "adhoc" | "direct"; label: string }
  | { kind: "unassigned"; label: string }
  | { kind: "age_min"; value: number; label: string };

export type CaseQueryResult = { tokens: CaseToken[]; leftover: string };

export type CaseFilter = {
  status?: string;
  type?: "amc" | "adhoc" | "direct";
  unassigned?: boolean;
  ageMin?: number;
};

const STATUS_WORDS: { re: RegExp; value: string; label: string }[] = [
  { re: /\bintake\b/i, value: "intake", label: "Stage: Intake" },
  { re: /\binspection\b/i, value: "inspection", label: "Stage: Inspection" },
  { re: /\breport\s*sent\b/i, value: "report_sent", label: "Stage: Report sent" },
  { re: /\breport\s*approved\b/i, value: "report_approved", label: "Stage: Report approved" },
  { re: /\bquote\s*sent\b/i, value: "quote_sent", label: "Stage: Quote sent" },
  { re: /\bquote\s*approved\b/i, value: "quote_approved", label: "Stage: Quote approved" },
  { re: /\bin[\s-]*repair\b/i, value: "in_repair", label: "Stage: In repair" },
  { re: /\bqa\b/i, value: "qa", label: "Stage: QA" },
  { re: /\bready\b/i, value: "ready", label: "Stage: Ready" },
];

export function parseCaseQuery(raw: string): CaseQueryResult {
  let text = raw;
  const tokens: CaseToken[] = [];

  const cut = (re: RegExp, onMatch: (m: RegExpMatchArray) => void) => {
    const m = text.match(re);
    if (!m) return;
    onMatch(m);
    text = text.slice(0, m.index) + " " + text.slice((m.index ?? 0) + m[0].length);
  };

  cut(/\b(?:unassigned|no technician|not assigned|nobody assigned)\b/i, () => {
    tokens.push({ kind: "unassigned", label: "Unassigned" });
  });

  cut(/\b(?:stuck|breaching sla)\b/i, () => {
    tokens.push({ kind: "age_min", value: 30, label: "Open ≥ 30 days" });
  });
  cut(/\b(?:opened|open(?:ed)?|older than|more than)\D{0,20}?(\d+)\s*(day|days|week|weeks)\s*(?:ago|old)?\b/i, (m) => {
    const n = parseInt(m[1], 10) * (/week/i.test(m[2]) ? 7 : 1);
    tokens.push({ kind: "age_min", value: n, label: `Open ≥ ${n} days` });
  });
  cut(/\b(?:opened|open(?:ed)?|older than|more than)\D{0,15}?\bfortnight\b/i, () => {
    if (!tokens.some((t) => t.kind === "age_min")) tokens.push({ kind: "age_min", value: 14, label: "Open ≥ 14 days" });
  });
  cut(/\b(?:opened|open(?:ed)?|older than|more than)\D{0,15}?\b(?:a\s*)?month\b/i, () => {
    if (!tokens.some((t) => t.kind === "age_min")) tokens.push({ kind: "age_min", value: 30, label: "Open ≥ 30 days" });
  });

  cut(/\bamc\b/i, () => tokens.push({ kind: "type", value: "amc", label: "Type: AMC" }));
  cut(/\badhoc\b/i, () => tokens.push({ kind: "type", value: "adhoc", label: "Type: Adhoc" }));
  cut(/\bdirect\b/i, () => tokens.push({ kind: "type", value: "direct", label: "Type: Direct" }));

  for (const { re, value, label } of STATUS_WORDS) {
    if (tokens.some((t) => t.kind === "status")) break;
    cut(re, () => tokens.push({ kind: "status", value, label }));
  }

  const leftover = text
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/^(?:that|which|and|with|the|have|has|cases?|for)\s+/i, "")
    .trim();

  return { tokens, leftover };
}

export function tokensToFilter(tokens: CaseToken[]): CaseFilter {
  const f: CaseFilter = {};
  for (const t of tokens) {
    if (t.kind === "status") f.status = t.value;
    else if (t.kind === "type") f.type = t.value;
    else if (t.kind === "unassigned") f.unassigned = true;
    else if (t.kind === "age_min") f.ageMin = t.value;
  }
  return f;
}

export function filterToParams(f: CaseFilter): URLSearchParams {
  const p = new URLSearchParams();
  if (f.status) p.set("status", f.status);
  if (f.type) p.set("type", f.type);
  if (f.unassigned) p.set("unassigned", "1");
  if (f.ageMin != null) p.set("age_min", String(f.ageMin));
  return p;
}

export function filterFromParams(p: URLSearchParams): CaseFilter {
  const f: CaseFilter = {};
  const status = p.get("status"); if (status) f.status = status;
  const type = p.get("type"); if (type === "amc" || type === "adhoc" || type === "direct") f.type = type;
  if (p.get("unassigned") === "1") f.unassigned = true;
  const ageMin = p.get("age_min"); if (ageMin) f.ageMin = Number(ageMin);
  return f;
}

export function matchesFilter(
  row: { status: string; type: string; unassigned: boolean; ageDays: number },
  f: CaseFilter
): boolean {
  if (f.status && row.status !== f.status) return false;
  if (f.type && row.type !== f.type) return false;
  if (f.unassigned && !row.unassigned) return false;
  if (f.ageMin != null && row.ageDays < f.ageMin) return false;
  return true;
}
