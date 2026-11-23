import { BUILDING_CODE_RE, ELEMENT_CODE_RE, ELEMENT_LIMITS, TYPE_CODE_RE } from "./types";

// The element-code pattern (docs/design/pcbs-buildings-elements.md section 2.2), pure. One workspace setting, frozen on a project when its first
// code is issued. Tokens: {project} (the project ref), {building} (the building code), {type} (the element type code), {seq:N} (a running
// number of N digits, 1 to 6). Literals only - . _ / . The pattern applies to the codes WE issue; a code the client typed or imported is kept
// as typed and only flagged when it falls outside the pattern.

export type PatternPart =
  | { kind: "lit"; text: string }
  | { kind: "project" }
  | { kind: "building" }
  | { kind: "type" }
  | { kind: "seq"; digits: number };

export type ParsedPattern = { ok: true; parts: PatternPart[] } | { ok: false; error: string };

const LITERAL_RE = /^[-._/]+$/;

export function parsePattern(pattern: string): ParsedPattern {
  const text = pattern.trim();
  if (!text) return { ok: false, error: "The pattern is empty" };
  if (text.length > ELEMENT_LIMITS.patternMax) return { ok: false, error: `The pattern is longer than ${ELEMENT_LIMITS.patternMax} characters` };
  const parts: PatternPart[] = [];
  let seqCount = 0;
  const re = /\{([^{}]*)\}|([^{}]+)|([{}])/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m[3]) return { ok: false, error: "A brace is not closed" };
    if (m[2] !== undefined) {
      if (!LITERAL_RE.test(m[2])) return { ok: false, error: "Between the tokens use only - . _ /" };
      parts.push({ kind: "lit", text: m[2] });
      continue;
    }
    const token = m[1];
    if (token === "project") parts.push({ kind: "project" });
    else if (token === "building") parts.push({ kind: "building" });
    else if (token === "type") parts.push({ kind: "type" });
    else if (token === "seq" || /^seq:\d$/.test(token)) {
      const digits = token === "seq" ? 4 : Number(token.slice(4));
      if (digits < 1 || digits > 6) return { ok: false, error: "{seq:N} takes 1 to 6 digits" };
      seqCount++;
      parts.push({ kind: "seq", digits });
    } else return { ok: false, error: `{${token}} is not a token. Use {project}, {building}, {type} and {seq:4}` };
  }
  if (seqCount !== 1) return { ok: false, error: seqCount === 0 ? "The pattern needs {seq:4}, the running number" : "The pattern takes one {seq}" };
  return { ok: true, parts };
}

/** The longest code the pattern can make: a project ref of `projectLen`, a building of 6 and a type of 5 characters at most. */
export function maxCodeLength(parts: readonly PatternPart[], projectLen = 12): number {
  return parts.reduce((n, p) => n + (p.kind === "lit" ? p.text.length : p.kind === "project" ? projectLen : p.kind === "building" ? ELEMENT_LIMITS.buildingMax : p.kind === "type" ? ELEMENT_LIMITS.typeMax : p.digits), 0);
}

export type PatternCheck = { ok: true; parts: PatternPart[]; max_length: number } | { ok: false; error: string };

/** Valid when it parses and the longest possible result fits `codeMax`. The screen shows `max_length` next to the live preview. */
export function validatePattern(pattern: string, codeMax: number = ELEMENT_LIMITS.codeMaxDefault, projectLen = 12): PatternCheck {
  const parsed = parsePattern(pattern);
  if (!parsed.ok) return parsed;
  const max = maxCodeLength(parsed.parts, projectLen);
  if (max > codeMax) return { ok: false, error: `The longest code would be ${max} characters; the limit is ${codeMax}` };
  return { ok: true, parts: parsed.parts, max_length: max };
}

export type CodeContext = { project: string | null; building: string; type: string };

export const seqMax = (digits: number): number => 10 ** digits - 1;

export function renderCode(parts: readonly PatternPart[], ctx: CodeContext, seq: number): string {
  return parts.map((p) => {
    if (p.kind === "lit") return p.text;
    if (p.kind === "project") return (ctx.project ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (p.kind === "building") return ctx.building;
    if (p.kind === "type") return ctx.type;
    return String(seq).padStart(p.digits, "0");
  }).join("");
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&");

/** The running number inside `code` when it was made by this pattern for this project, building and type; else null. */
export function extractSeq(parts: readonly PatternPart[], ctx: CodeContext, code: string): number | null {
  const source = parts.map((p) => {
    if (p.kind === "lit") return escapeRe(p.text);
    if (p.kind === "project") return escapeRe(renderCode([p], ctx, 0));
    if (p.kind === "building") return escapeRe(ctx.building);
    if (p.kind === "type") return escapeRe(ctx.type);
    return `(\\d{${p.digits},})`;
  }).join("");
  const m = new RegExp(`^${source}$`).exec(code);
  return m ? Number(m[1]) : null;
}

/** Highest running number issued so far for this project, building and type, plus one. Gaps are never refilled. */
export function nextSeq(parts: readonly PatternPart[], ctx: CodeContext, existing: Iterable<string>): number {
  let high = 0;
  for (const code of existing) {
    const n = extractSeq(parts, ctx, code);
    if (n !== null && n > high) high = n;
  }
  return high + 1;
}

/** Does the code look like something this pattern could make (any building, any type)? A client's own code that does not is "outside pattern". */
export function insidePattern(parts: readonly PatternPart[], code: string, project: string | null = null): boolean {
  const source = parts.map((p) => {
    if (p.kind === "lit") return escapeRe(p.text);
    if (p.kind === "project") return project === null ? "[A-Z0-9]*" : escapeRe(renderCode([p], { project, building: "", type: "" }, 0));
    if (p.kind === "building") return "[A-Z0-9]{1,6}";
    if (p.kind === "type") return "[A-Z0-9]{2,5}";
    return `\\d{${p.digits},}`;
  }).join("");
  return new RegExp(`^${source}$`).test(code);
}

/** Two sample codes, so the Settings screen can show what the pattern makes before it is saved. */
export function previewCodes(parts: readonly PatternPart[], project = "CPR-0001"): string[] {
  const ctx: CodeContext = { project, building: "B01", type: "HCS" };
  return [renderCode(parts, ctx, 1), renderCode(parts, ctx, 2)];
}

// ── Typed codes ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** A code typed or imported: upper-cased and trimmed. Returns the problem instead of the code when it cannot be used. */
export function cleanElementCode(raw: unknown, codeMax: number = ELEMENT_LIMITS.codeMaxDefault): { ok: true; code: string } | { ok: false; error: string } {
  if (typeof raw !== "string" || !raw.trim()) return { ok: false, error: "The element code is empty" };
  const code = raw.trim().toUpperCase();
  if (!ELEMENT_CODE_RE.test(code)) return { ok: false, error: "A code uses A-Z, 0-9 and - . _ / and starts with a letter or a digit" };
  if (code.length > codeMax) return { ok: false, error: `A code is at most ${codeMax} characters` };
  return { ok: true, code };
}

export const cleanBuildingCode = (raw: unknown): string | null => {
  const code = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  return BUILDING_CODE_RE.test(code) ? code : null;
};
export const cleanTypeCode = (raw: unknown): string | null => {
  const code = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  return TYPE_CODE_RE.test(code) ? code : null;
};

// ── Issuing ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export type IssueLine = {
  key: string;
  line_no: number;
  building_code: string | null;
  element_type: string | null;
  element_code: string | null;
  /** A cost-only category line of a contract line: it never carries a code (it inherits through source_line_id). */
  is_category?: boolean;
};

export type IssueGroup = { building: string; type: string; count: number; from: string; to: string };
export type IssuePlan = {
  assignments: { key: string; code: string; building: string; type: string }[];
  /** Lines that could not get a code, with the reason in words. A line that already has a code is not here: issuing is idempotent. */
  skipped: { key: string; reason: string }[];
  groups: IssueGroup[];
  /** "14 codes: B01-HCS-0001 to B01-HCS-0014", one line per group. */
  summary: string[];
};

/**
 * What "Issue codes" would do. Lines with a code are left alone; a line needs a building and a type; category lines are not lines of an
 * element. The running number counts per building and type, one above the highest already issued (any code in `existing` that fits the
 * pattern for that building and type), and a number that would collide with a code already in the workspace's scope is stepped over.
 * Order is the line order, so the same budget always gets the same codes.
 */
export function planIssue(args: { parts: readonly PatternPart[]; codeMax: number; project: string | null; lines: readonly IssueLine[]; existing: Iterable<string> }): IssuePlan {
  const taken = new Set<string>(args.existing);
  const seqPart = args.parts.find((p): p is Extract<PatternPart, { kind: "seq" }> => p.kind === "seq");
  const limit = seqMax(seqPart?.digits ?? 4);
  const out: IssuePlan = { assignments: [], skipped: [], groups: [], summary: [] };
  const todo = args.lines.filter((l) => !l.element_code && !l.is_category).sort((a, b) => a.line_no - b.line_no);
  const counters = new Map<string, number>();
  const groups = new Map<string, IssueGroup>();
  for (const l of todo) {
    if (!l.building_code) { out.skipped.push({ key: l.key, reason: "Not in a building" }); continue; }
    if (!l.element_type) { out.skipped.push({ key: l.key, reason: "No element type" }); continue; }
    const ctx: CodeContext = { project: args.project, building: l.building_code, type: l.element_type };
    const gk = `${l.building_code}|${l.element_type}`;
    let seq = counters.get(gk) ?? nextSeq(args.parts, ctx, taken);
    let code = renderCode(args.parts, ctx, seq);
    while (taken.has(code) && seq <= limit) { seq++; code = renderCode(args.parts, ctx, seq); }
    if (seq > limit) { out.skipped.push({ key: l.key, reason: "Out of numbers: use more digits in {seq}" }); continue; }
    if (code.length > args.codeMax) { out.skipped.push({ key: l.key, reason: `The code would be ${code.length} characters; the limit is ${args.codeMax}` }); continue; }
    counters.set(gk, seq + 1);
    taken.add(code);
    out.assignments.push({ key: l.key, code, building: l.building_code, type: l.element_type });
    const g = groups.get(gk);
    if (g) { g.count++; g.to = code; } else groups.set(gk, { building: l.building_code, type: l.element_type, count: 1, from: code, to: code });
  }
  out.groups = [...groups.values()];
  out.summary = out.groups.map((g) => `${g.count} code${g.count === 1 ? "" : "s"}: ${g.count === 1 ? g.from : `${g.from} to ${g.to}`}`);
  return out;
}

// ── Renaming and reissuing ────────────────────────────────────────────────────────────────────────────────────────────

export type ReissueRow = { key: string; from: string; to: string };

/**
 * "Reissue codes" after a building or element-type code changed: every code that was made by the pattern for the OLD building / type becomes
 * the code the pattern makes for the new one, keeping its running number. A code that does not fit the old pattern (typed by the client) is
 * left alone. Pure: the route decides whether reissuing is allowed at all (never after a baseline is approved or a push).
 */
export function planReissue(args: {
  parts: readonly PatternPart[];
  project: string | null;
  lines: readonly { key: string; element_code: string | null; building_code: string | null; element_type: string | null }[];
  change: { building?: { from: string; to: string }; type?: { from: string; to: string } };
}): { rows: ReissueRow[]; clashes: string[] } {
  const rows: ReissueRow[] = [];
  for (const l of args.lines) {
    if (!l.element_code || !l.building_code || !l.element_type) continue;
    const oldB = args.change.building ? args.change.building.from : l.building_code;
    const oldT = args.change.type ? args.change.type.from : l.element_type;
    if ((args.change.building && l.building_code !== args.change.building.to && l.building_code !== args.change.building.from) || (args.change.type && l.element_type !== args.change.type.to && l.element_type !== args.change.type.from)) continue;
    const seq = extractSeq(args.parts, { project: args.project, building: oldB, type: oldT }, l.element_code);
    if (seq === null) continue;
    const newB = args.change.building ? args.change.building.to : l.building_code;
    const newT = args.change.type ? args.change.type.to : l.element_type;
    const to = renderCode(args.parts, { project: args.project, building: newB, type: newT }, seq);
    if (to !== l.element_code) rows.push({ key: l.key, from: l.element_code, to });
  }
  const targets = new Map<string, number>();
  for (const r of rows) targets.set(r.to, (targets.get(r.to) ?? 0) + 1);
  const staying = new Set(args.lines.filter((l) => l.element_code && !rows.some((r) => r.key === l.key)).map((l) => l.element_code as string));
  const clashes = [...new Set(rows.filter((r) => (targets.get(r.to) ?? 0) > 1 || staying.has(r.to)).map((r) => r.to))];
  return { rows, clashes };
}
