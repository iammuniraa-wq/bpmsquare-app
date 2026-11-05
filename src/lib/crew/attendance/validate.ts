// The validator the runner applies to `submit_findings` (design 2 "Grounding contract", 5.5, 7).
//
//  - the model types no digits: numbers and dates reach the text only through {{step.path|format}} placeholders that the
//    server fills from the tool result, so a figure in a finding is a figure a tool returned;
//  - every finding cites evidence (step + path) that exists in the facts, and the candidate it is about;
//  - a person may be named only when the plain detector made a person-level candidate for them (the site does not explain it);
//  - every finding carries at least one non-personal alternative explanation;
//  - banned wording, comparing people, naming a person for a site-level pattern: dropped;
//  - proposals are only `wfm.recheck` (to a supervisor, who edits and sends it as their own message) and `site_note`.
// A dropped item is returned with its reasons so the trace can show "ungrounded / banned wording / out of scope".

import { ALIAS_TOKEN } from "./alias";
import { longDate, shortDate } from "./dates";
import type { Candidate } from "./detectors";
import type { SiteDigest } from "./digest";
import { SEVERITY_LABEL, checkEmployeeFacingWording, checkWording } from "./wording";
import {
  LIMITS,
  type ActionCode,
  type ExplanationCode,
  type Submission,
  type SubmittedFinding,
  type SubmittedProposal,
} from "./submission";

/** Tool results of the run by step id. `s1` is the site digest. */
export type RunFacts = Record<string, unknown>;

export const DIGEST_STEP = "s1";

// ── paths and placeholders ──────────────────────────────────────────────────

const PLACEHOLDER = /\{\{\s*([^{}|]+?)\s*(?:\|\s*(date|dates|list|longdates)\s*)?\}\}/g;
const ANY_PLACEHOLDER = /\{\{[^{}]*\}\}/g;

/** "s1.candidates[0].days" -> the value, or undefined when any hop is missing. */
export function getByPath(facts: RunFacts, full: string): unknown {
  const parts = full.match(/[^.[\]]+|\[\d+\]/g);
  if (!parts || parts.length < 2) return undefined;
  let cur: unknown = facts[parts[0]];
  for (const part of parts.slice(1)) {
    if (cur === null || cur === undefined) return undefined;
    if (part.startsWith("[")) {
      if (!Array.isArray(cur)) return undefined;
      cur = cur[Number(part.slice(1, -1))];
    } else {
      if (typeof cur !== "object" || Array.isArray(cur)) return undefined;
      cur = (cur as Record<string, unknown>)[part];
    }
  }
  return cur;
}

const UNTRUSTED_PATH = /untrusted|shift_label/i;

function formatValue(v: unknown, fmt: string | undefined): string | null {
  const one = (x: unknown): string | null => {
    if (typeof x === "number" && Number.isFinite(x)) return String(x);
    if (typeof x !== "string") return null;
    if (fmt === "date" || fmt === "dates") return /^\d{4}-\d{2}-\d{2}$/.test(x) ? shortDate(x) : null;
    if (fmt === "longdates") return /^\d{4}-\d{2}-\d{2}$/.test(x) ? longDate(x) : null;
    return x;
  };
  if (Array.isArray(v)) {
    if (fmt !== "dates" && fmt !== "list" && fmt !== "longdates") return null;
    const items = v.map(one);
    if (items.some((i) => i === null) || items.length === 0) return null;
    const list = items as string[];
    return list.length === 1 ? list[0] : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
  }
  if (typeof v === "boolean" || v === null || typeof v === "object") return null;
  return one(v);
}

export type RenderResult = { ok: true; text: string } | { ok: false; reason: string };

/** Fill placeholders; reject digits outside them (aliases excepted) and any unresolvable or untrusted placeholder. */
export function renderTemplate(tmpl: string, facts: RunFacts): RenderResult {
  const stripped = tmpl.replace(ANY_PLACEHOLDER, " ").replace(ALIAS_TOKEN, " ");
  if (/\d/.test(stripped)) return { ok: false, reason: "digit_outside_placeholder" };
  if ((tmpl.match(/\{\{/g) ?? []).length !== (tmpl.match(ANY_PLACEHOLDER) ?? []).length) return { ok: false, reason: "malformed_placeholder" };
  let bad: string | null = null;
  const text = tmpl.replace(PLACEHOLDER, (_m, path: string, fmt: string | undefined) => {
    if (UNTRUSTED_PATH.test(path)) { bad = "placeholder_untrusted"; return ""; }
    const value = formatValue(getByPath(facts, path), fmt);
    if (value === null) { bad = "unresolved_placeholder"; return ""; }
    return value;
  });
  // a placeholder the strict form did not accept (unknown format, stray braces) is left in the text
  if (!bad && /[{}]/.test(text)) bad = "malformed_placeholder";
  return bad ? { ok: false, reason: bad } : { ok: true, text: text.replace(/\s+/g, " ").trim() };
}

// ── rendered results ────────────────────────────────────────────────────────

export type RenderedFinding = {
  /** Index in the submission. */
  index: number;
  candidate_id: string;
  kind: SubmittedFinding["kind"];
  level: SubmittedFinding["level"];
  severity: SubmittedFinding["severity"];
  severity_label: string;
  subject: SubmittedFinding["subject"];
  title: string;
  observed: string;
  explanations: { code: ExplanationCode; text: string }[];
  actions: { code: ActionCode; text: string }[];
  evidence: { step: string; path: string; label: string }[];
  gaps: string[];
};

export type RenderedProposal =
  | { index: number; action: "wfm.recheck"; finding_index: number; target_aliases: string[]; message: string }
  | { index: number; action: "site_note"; finding_index: number; message: string };

export type Dropped = { kind: "finding" | "proposal"; index: number; reasons: string[] };

export type ValidationResult = { findings: RenderedFinding[]; proposals: RenderedProposal[]; dropped: Dropped[]; nothing_to_report: string | null };

function digestOf(facts: RunFacts): SiteDigest | null {
  const d = facts[DIGEST_STEP] as SiteDigest | undefined;
  return d && Array.isArray(d.candidates) ? d : null;
}

function candidateIndex(digest: SiteDigest, id: string): number {
  return digest.candidates.findIndex((c: Candidate) => c.id === id);
}

function validateFinding(f: SubmittedFinding, index: number, facts: RunFacts, digest: SiteDigest): { ok: true; value: RenderedFinding } | { ok: false; reasons: string[] } {
  const reasons: string[] = [];
  const ci = candidateIndex(digest, f.candidate_id);
  const cand = ci >= 0 ? digest.candidates[ci] : null;

  if (!cand) reasons.push("unknown_candidate");
  else {
    if (cand.family !== f.kind || cand.level !== f.level) reasons.push("candidate_mismatch");
    if (f.subject.type !== f.level) reasons.push("candidate_mismatch");
    const expectedAlias = cand.level === "person" ? cand.person : cand.site;
    if (f.subject.alias !== expectedAlias) reasons.push("candidate_mismatch");
    // the structural rule behind "no naming a person where only a site-level pattern is supported"
    if (f.level === "person" && (!cand.person_eligible || cand.site_pattern || cand.level !== "person")) reasons.push("person_not_supported");
  }

  // evidence
  const evidenceOk = f.evidence.every((e) => /^s\d+$/.test(e.step) && getByPath(facts, `${e.step}.${e.path}`) !== undefined);
  if (!evidenceOk) reasons.push("ungrounded_evidence");
  else if (ci >= 0 && !f.evidence.some((e) => e.step === DIGEST_STEP && (e.path === `candidates[${ci}]` || e.path.startsWith(`candidates[${ci}].`)))) {
    reasons.push("no_candidate_evidence");
  }

  // templates
  const render = (t: string) => {
    const r = renderTemplate(t, facts);
    if (!r.ok) reasons.push(r.reason);
    return r.ok ? r.text : "";
  };
  const title = render(f.title_tmpl);
  const observed = render(f.observed_tmpl);
  const explanations = f.explanations.map((e) => ({ code: e.code, text: render(e.text_tmpl) }));
  const actions = f.actions.map((a) => ({ code: a.code, text: render(a.text_tmpl) }));
  if (explanations.length === 0) reasons.push("missing_explanation");
  if (actions.length === 0) reasons.push("missing_actions");
  if (f.actions.some((a) => a.code === "ask_for_recheck") && f.level === "site" && f.kind !== "missing_out_cluster") reasons.push("recheck_not_for_this_pattern");

  // wording on the rendered text
  const all = [title, observed, ...explanations.map((e) => e.text), ...actions.map((a) => a.text), ...f.gaps, ...f.evidence.map((e) => e.label)];
  for (const p of checkWording(all, { level: f.level })) reasons.push(`${p.code}:${p.detail}`);

  const uniq = [...new Set(reasons)];
  if (uniq.length > 0) return { ok: false, reasons: uniq };
  return {
    ok: true,
    value: {
      index, candidate_id: f.candidate_id, kind: f.kind, level: f.level, severity: f.severity, severity_label: SEVERITY_LABEL[f.severity],
      subject: f.subject, title, observed, explanations, actions, evidence: f.evidence, gaps: f.gaps,
    },
  };
}

function validateProposal(
  p: SubmittedProposal,
  index: number,
  facts: RunFacts,
  digest: SiteDigest,
  accepted: Map<number, RenderedFinding>
): { ok: true; value: RenderedProposal } | { ok: false; reasons: string[] } {
  const reasons: string[] = [];
  const finding = accepted.get(p.finding_index);
  if (!finding) return { ok: false, reasons: ["finding_dropped_or_missing"] };
  const cand = digest.candidates[candidateIndex(digest, finding.candidate_id)];

  const r = renderTemplate(p.message_tmpl, facts);
  if (!r.ok) reasons.push(r.reason);
  const message = r.ok ? r.text : "";
  if (message.length === 0 && r.ok) reasons.push("empty_message");

  if (p.action === "site_note") {
    if (finding.level !== "site") reasons.push("site_note_needs_site_finding");
    for (const w of checkWording([message], { level: "site" })) reasons.push(`${w.code}:${w.detail}`);
    if (reasons.length > 0) return { ok: false, reasons: [...new Set(reasons)] };
    return { ok: true, value: { index, action: "site_note", finding_index: p.finding_index, message } };
  }

  // wfm.recheck: one person's own finding, or the people behind a missing-out cluster
  const targets = [...new Set(p.target_aliases)];
  if (targets.length > LIMITS.recheckTargets) reasons.push("too_many_targets");
  if (finding.level === "person") {
    if (targets.length !== 1 || targets[0] !== finding.subject.alias) reasons.push("recheck_target_mismatch");
  } else if (finding.kind === "missing_out_cluster") {
    if (!cand || !targets.every((t) => cand.members.includes(t))) reasons.push("recheck_target_mismatch");
  } else {
    reasons.push("recheck_not_for_this_pattern");
  }
  // it reaches an employee as their supervisor's own words: no agent, no AI, no alias, no banned term
  for (const w of checkEmployeeFacingWording(message)) reasons.push(`${w.code}:${w.detail}`);
  if (reasons.length > 0) return { ok: false, reasons: [...new Set(reasons)] };
  return { ok: true, value: { index, action: "wfm.recheck", finding_index: p.finding_index, target_aliases: targets, message } };
}

/** Validate a parsed submission against the run's tool results. Never throws. */
export function validateSubmission(sub: Submission, facts: RunFacts): ValidationResult {
  const digest = digestOf(facts);
  const dropped: Dropped[] = [];
  if (!digest) {
    return { findings: [], proposals: [], dropped: sub.findings.map((_, i) => ({ kind: "finding", index: i, reasons: ["no_digest"] })), nothing_to_report: sub.nothing_to_report };
  }
  const accepted = new Map<number, RenderedFinding>();
  const seenCandidates = new Set<string>();
  sub.findings.forEach((f, i) => {
    if (seenCandidates.has(f.candidate_id)) return void dropped.push({ kind: "finding", index: i, reasons: ["duplicate_candidate"] });
    const r = validateFinding(f, i, facts, digest);
    if (r.ok) { accepted.set(i, r.value); seenCandidates.add(f.candidate_id); }
    else dropped.push({ kind: "finding", index: i, reasons: r.reasons });
  });
  const proposals: RenderedProposal[] = [];
  const seenProposal = new Set<string>();
  sub.proposals.forEach((p, i) => {
    const key = `${p.action}|${p.finding_index}`;
    if (seenProposal.has(key)) return void dropped.push({ kind: "proposal", index: i, reasons: ["duplicate_proposal"] });
    const r = validateProposal(p, i, facts, digest, accepted);
    if (r.ok) { proposals.push(r.value); seenProposal.add(key); }
    else dropped.push({ kind: "proposal", index: i, reasons: r.reasons });
  });
  return { findings: [...accepted.values()], proposals, dropped, nothing_to_report: sub.nothing_to_report };
}
