// The grounding contract (docs/design/nova-crew-agents.md section 2), enforced rather than hoped for. Pure: no I/O, so every rule is
// unit-tested without a model or a database.
//
//   1. A finding cites tool results by step id and a path inside that step's output.
//   2. The model types NO digits: numbers, dates and counts appear in a template only as {{sN.path}} placeholders; the server
//      substitutes the value from the cited result. A digit outside a placeholder rejects the template.
//   3. A finding with no evidence, or whose cited path is absent from the cited result, is dropped.
//   4. Links are built by the server from {type, id}; a template may not carry a URL.
//   5. The agent's banned-terms list is applied to every rendered text; a hit drops the finding.

import type { ActionKey, DraftFinding, EvidenceView, Ref, Severity } from "../types";

export const PLACEHOLDER = /\{\{\s*(s\d+)\.([A-Za-z0-9_.[\]-]+)(?:\|([a-z_]+))?\s*\}\}/g;
const SEVERITIES: readonly Severity[] = ["info", "review", "urgent"];

/** Reads `a.b[2].c` out of a value. Undefined when any hop is missing. */
export function getPath(value: unknown, path: string): unknown {
  let cur: unknown = value;
  for (const part of path.split(".").flatMap((p) => p.split(/\[(\d+)\]/).filter((x) => x !== ""))) {
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur)) {
      const i = Number(part);
      if (!Number.isInteger(i)) return undefined;
      cur = cur[i];
    } else if (typeof cur === "object") {
      cur = (cur as Record<string, unknown>)[part];
    } else return undefined;
  }
  return cur;
}

/** The problems that make a template unusable. An empty list means the text only carries words and placeholders. */
export function templateProblems(tmpl: unknown): string[] {
  if (typeof tmpl !== "string" || !tmpl.trim()) return ["empty text"];
  const out: string[] = [];
  const bare = tmpl.replace(PLACEHOLDER, " ");
  if (/\d/.test(bare)) out.push("a digit outside a placeholder (write numbers and dates only as {{sN.path}})");
  if (/\{\{|\}\}/.test(bare)) out.push("a malformed placeholder");
  if (/https?:\/\/|www\./i.test(bare)) out.push("a link (links are built by the server)");
  if (/[<>]/.test(bare)) out.push("markup");
  if (tmpl.length > 1200) out.push("too long");
  return out;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatDate(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (!m) return null;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}

function formatValue(v: unknown, fmt: string | undefined): string | null {
  if (v === null || v === undefined) return null;
  if (fmt === "date") return formatDate(v);
  if (typeof v === "number") return Number.isFinite(v) ? v.toLocaleString("en-GB", { maximumFractionDigits: 1 }) : null;
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "string") return v.replace(/[<>\r\n]+/g, " ").trim().slice(0, 200) || null;
  return null;
}

export type StepOutputs = ReadonlyMap<string, unknown>;

/** Fills every placeholder from the cited step outputs. Reports each one that could not be resolved. */
export function renderTemplate(tmpl: string, steps: StepOutputs): { ok: true; text: string } | { ok: false; missing: string[] } {
  const missing: string[] = [];
  const text = tmpl.replace(PLACEHOLDER, (_all, step: string, path: string, fmt: string | undefined) => {
    const out = steps.has(step) ? formatValue(getPath(steps.get(step), path), fmt) : null;
    if (out === null) { missing.push(`${step}.${path}`); return ""; }
    return out;
  });
  return missing.length ? { ok: false, missing } : { ok: true, text: text.replace(/\s{2,}/g, " ").trim() };
}

/** A banned term as a whole word or phrase, case-insensitive. */
export function bannedHits(text: string, banned: readonly string[]): string[] {
  const hay = text.toLowerCase();
  return banned.filter((term) => new RegExp(`(^|[^a-z])${term.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`).test(hay));
}

export type ValidatedProposal = { action_key: ActionKey; target_type: string; target_id: string; recipient_ids: string[]; message: string };
export type ValidatedFinding = {
  kind: string; severity: Severity; subject_type: string; subject_id: string;
  title: string; body: string; evidence: EvidenceView[]; gaps: string[]; proposal: ValidatedProposal | null;
};

export type ValidateEnv = {
  steps: StepOutputs;
  /** Ids the finding's subject (and proposal target) may name. */
  candidateIds: ReadonlySet<string>;
  kinds: readonly string[];
  banned: readonly string[];
  actions: readonly ActionKey[];
  /** Recipients a proposal may address for this subject; null = no proposal allowed for it. */
  permittedRecipients: (finding: DraftFinding) => ReadonlySet<string> | null;
  /** Server-built link for a step ref, if the step carries one. */
  refsOf: (step: string) => Ref[];
  hrefFor: (ref: Ref) => string | null;
};

export type Verdict = { ok: true; finding: ValidatedFinding } | { ok: false; reason: string };

/** Runs one draft finding through every rule. The reason is shown in the trace ("ungrounded", "banned wording", ...). */
export function validateDraft(d: DraftFinding, env: ValidateEnv): Verdict {
  if (!d || typeof d !== "object") return { ok: false, reason: "malformed finding" };
  if (!env.kinds.includes(d.kind)) return { ok: false, reason: `ungrounded: unknown kind "${String(d.kind).slice(0, 40)}"` };
  if (!SEVERITIES.includes(d.severity)) return { ok: false, reason: "ungrounded: unknown severity" };
  if (!d.subject || typeof d.subject.id !== "string" || !env.candidateIds.has(d.subject.id)) return { ok: false, reason: "out of scope: the subject was not one of this run's candidates" };
  if (!Array.isArray(d.evidence) || d.evidence.length === 0) return { ok: false, reason: "ungrounded: no evidence" };

  const evidence: EvidenceView[] = [];
  for (const e of d.evidence) {
    if (!e || typeof e.step !== "string" || typeof e.path !== "string" || !env.steps.has(e.step)) return { ok: false, reason: "ungrounded: evidence cites a step that does not exist" };
    if (getPath(env.steps.get(e.step), e.path) === undefined) return { ok: false, reason: `ungrounded: ${e.step}.${e.path} is not in that result` };
    const ref = env.refsOf(e.step)[0];
    evidence.push({ step: e.step, path: e.path, label: String(e.label ?? e.path).slice(0, 80), href: ref ? env.hrefFor(ref) : null });
  }

  for (const [name, tmpl] of [["title", d.title_tmpl], ["body", d.body_tmpl]] as const) {
    const p = templateProblems(tmpl);
    if (p.length) return { ok: false, reason: `ungrounded: ${name} has ${p[0]}` };
  }
  const title = renderTemplate(d.title_tmpl, env.steps);
  if (!title.ok) return { ok: false, reason: `ungrounded: ${title.missing[0]} is not in the cited results` };
  const body = renderTemplate(d.body_tmpl, env.steps);
  if (!body.ok) return { ok: false, reason: `ungrounded: ${body.missing[0]} is not in the cited results` };
  const gaps = (Array.isArray(d.gaps) ? d.gaps : []).filter((g): g is string => typeof g === "string").map((g) => g.replace(/[<>]/g, "").trim().slice(0, 200)).filter(Boolean).slice(0, 6);
  if (gaps.some((g) => /\d/.test(g))) return { ok: false, reason: "ungrounded: a gap carries a digit" };

  let proposal: ValidatedProposal | null = null;
  if (d.proposal) {
    const pr = d.proposal;
    const allowed = env.permittedRecipients(d);
    if (!env.actions.includes(pr.action_key)) return { ok: false, reason: "out of scope: action not allowed for this agent" };
    if (!allowed) return { ok: false, reason: "out of scope: no proposal is allowed for this finding" };
    if (!env.candidateIds.has(pr.target_id)) return { ok: false, reason: "out of scope: proposal target is not a candidate" };
    const ids = Array.isArray(pr.recipient_ids) ? pr.recipient_ids.filter((x): x is string => typeof x === "string") : [];
    if (ids.length === 0 || ids.some((id) => !allowed.has(id))) return { ok: false, reason: "out of scope: recipient not permitted for this finding" };
    const p = templateProblems(pr.message_tmpl);
    if (p.length) return { ok: false, reason: `ungrounded: the draft note has ${p[0]}` };
    const msg = renderTemplate(pr.message_tmpl, env.steps);
    if (!msg.ok) return { ok: false, reason: `ungrounded: ${msg.missing[0]} is not in the cited results` };
    const hit = bannedHits(msg.text, env.banned);
    if (hit.length) return { ok: false, reason: `banned wording: ${hit[0]}` };
    proposal = { action_key: pr.action_key, target_type: String(pr.target_type || "opportunity").slice(0, 40), target_id: pr.target_id, recipient_ids: [...new Set(ids)], message: msg.text };
  }

  const hits = bannedHits(`${title.text} ${body.text} ${gaps.join(" ")}`, env.banned);
  if (hits.length) return { ok: false, reason: `banned wording: ${hits[0]}` };

  return {
    ok: true,
    finding: { kind: d.kind, severity: d.severity, subject_type: String(d.subject.type || "opportunity").slice(0, 40), subject_id: d.subject.id, title: title.text, body: body.text, evidence, gaps, proposal },
  };
}
