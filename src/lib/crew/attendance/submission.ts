// The only thing the model "returns": `submit_findings`. Nothing in it is executed. This file holds the shape, the closed
// vocabularies (explanation codes are non-personal by construction), and a strict hand parser (no extra keys, no recipient
// of any kind on a proposal, so a message to an employee cannot even be expressed).

import { ATTENDANCE_FAMILIES, type AttendanceFamily } from "./facts";
import type { Severity } from "./contract";

/** "What else could explain it": every code is a non-personal reason. A person-level finding needs at least one. */
export const EXPLANATION_CODES = [
  "shift_start_or_grace_setting",
  "transport_or_gate_process",
  "site_boundary_or_pin_setting",
  "phone_location_or_gps_problem",
  "device_or_network_problem",
  "roster_or_site_change_not_recorded",
  "approved_work_elsewhere_not_rostered",
  "holiday_or_local_event",
  "process_or_procedure_change",
  "end_of_shift_handover_routine",
] as const;
export type ExplanationCode = (typeof EXPLANATION_CODES)[number];

/** "What you could do". */
export const ACTION_CODES = [
  "review_shift_setting",
  "check_site_boundary_setting",
  "check_device_or_network",
  "ask_for_recheck",
  "check_roster",
  "keep_an_eye_next_week",
  "nothing",
] as const;
export type ActionCode = (typeof ACTION_CODES)[number];

export const PROPOSAL_ACTIONS = ["wfm.recheck", "site_note"] as const;
export type ProposalAction = (typeof PROPOSAL_ACTIONS)[number];

export type Evidence = { step: string; path: string; label: string };

export type SubmittedFinding = {
  candidate_id: string;
  kind: AttendanceFamily;
  level: "site" | "person";
  severity: Severity;
  subject: { type: "site" | "person"; alias: string };
  title_tmpl: string;
  observed_tmpl: string;
  explanations: { code: ExplanationCode; text_tmpl: string }[];
  actions: { code: ActionCode; text_tmpl: string }[];
  evidence: Evidence[];
  gaps: string[];
};

export type SubmittedProposal =
  | { action: "wfm.recheck"; finding_index: number; target_aliases: string[]; message_tmpl: string }
  | { action: "site_note"; finding_index: number; message_tmpl: string };

export type Submission = {
  findings: SubmittedFinding[];
  proposals: SubmittedProposal[];
  /** One line saying why there is nothing to report. Required when findings is empty. */
  nothing_to_report: string | null;
};

export const LIMITS = { findings: 25, proposals: 25, recheckTargets: 25, title: 120, observed: 400, line: 240, message: 500, gaps: 5 } as const;

/** JSON Schema for the submit_findings tool. */
export const SUBMISSION_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["findings", "proposals", "nothing_to_report"],
  properties: {
    findings: {
      type: "array",
      maxItems: LIMITS.findings,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["candidate_id", "kind", "level", "severity", "subject", "title_tmpl", "observed_tmpl", "explanations", "actions", "evidence", "gaps"],
        properties: {
          candidate_id: { type: "string", description: "id of a candidate in the digest, e.g. c2" },
          kind: { type: "string", enum: [...ATTENDANCE_FAMILIES] },
          level: { type: "string", enum: ["site", "person"] },
          severity: { type: "string", enum: ["info", "review", "urgent"] },
          subject: {
            type: "object", additionalProperties: false, required: ["type", "alias"],
            properties: { type: { type: "string", enum: ["site", "person"] }, alias: { type: "string" } },
          },
          title_tmpl: { type: "string", maxLength: LIMITS.title, description: "No digits: use {{s1.path}} placeholders." },
          observed_tmpl: { type: "string", maxLength: LIMITS.observed },
          explanations: {
            type: "array", minItems: 1, maxItems: 4,
            items: {
              type: "object", additionalProperties: false, required: ["code", "text_tmpl"],
              properties: { code: { type: "string", enum: [...EXPLANATION_CODES] }, text_tmpl: { type: "string", maxLength: LIMITS.line } },
            },
          },
          actions: {
            type: "array", minItems: 1, maxItems: 3,
            items: {
              type: "object", additionalProperties: false, required: ["code", "text_tmpl"],
              properties: { code: { type: "string", enum: [...ACTION_CODES] }, text_tmpl: { type: "string", maxLength: LIMITS.line } },
            },
          },
          evidence: {
            type: "array", minItems: 1, maxItems: 8,
            items: {
              type: "object", additionalProperties: false, required: ["step", "path", "label"],
              properties: { step: { type: "string" }, path: { type: "string" }, label: { type: "string", maxLength: 80 } },
            },
          },
          gaps: { type: "array", maxItems: LIMITS.gaps, items: { type: "string", maxLength: LIMITS.line } },
        },
      },
    },
    proposals: {
      type: "array",
      maxItems: LIMITS.proposals,
      items: {
        type: "object",
        oneOf: [
          {
            additionalProperties: false, required: ["action", "finding_index", "target_aliases", "message_tmpl"],
            properties: {
              action: { const: "wfm.recheck" }, finding_index: { type: "integer", minimum: 0 },
              target_aliases: { type: "array", minItems: 1, maxItems: LIMITS.recheckTargets, items: { type: "string" } },
              message_tmpl: { type: "string", maxLength: LIMITS.message },
            },
          },
          {
            additionalProperties: false, required: ["action", "finding_index", "message_tmpl"],
            properties: { action: { const: "site_note" }, finding_index: { type: "integer", minimum: 0 }, message_tmpl: { type: "string", maxLength: LIMITS.message } },
          },
        ],
      },
    },
    nothing_to_report: { type: ["string", "null"], maxLength: LIMITS.line },
  },
};

// ── strict parser ───────────────────────────────────────────────────────────

type Parsed = { ok: true; value: Submission } | { ok: false; errors: string[] };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const noExtra = (o: Record<string, unknown>, allowed: string[], where: string, errors: string[]) => {
  for (const k of Object.keys(o)) if (!allowed.includes(k)) errors.push(`${where}: unexpected key '${k}'`);
};

export function parseSubmission(raw: unknown): Parsed {
  const errors: string[] = [];
  if (!isObj(raw)) return { ok: false, errors: ["submission is not an object"] };
  noExtra(raw, ["findings", "proposals", "nothing_to_report"], "submission", errors);
  const findings: SubmittedFinding[] = [];
  const proposals: SubmittedProposal[] = [];

  if (!Array.isArray(raw.findings)) errors.push("findings must be an array");
  else if (raw.findings.length > LIMITS.findings) errors.push("too many findings");
  else raw.findings.forEach((f, i) => {
    const w = `findings[${i}]`;
    if (!isObj(f)) return void errors.push(`${w}: not an object`);
    noExtra(f, ["candidate_id", "kind", "level", "severity", "subject", "title_tmpl", "observed_tmpl", "explanations", "actions", "evidence", "gaps"], w, errors);
    const subject = isObj(f.subject) ? f.subject : null;
    if (!isStr(f.candidate_id)) errors.push(`${w}: candidate_id`);
    if (!(ATTENDANCE_FAMILIES as readonly unknown[]).includes(f.kind)) errors.push(`${w}: kind`);
    if (f.level !== "site" && f.level !== "person") errors.push(`${w}: level`);
    if (f.severity !== "info" && f.severity !== "review" && f.severity !== "urgent") errors.push(`${w}: severity`);
    if (!subject || (subject.type !== "site" && subject.type !== "person") || !isStr(subject.alias)) errors.push(`${w}: subject`);
    if (!isStr(f.title_tmpl) || f.title_tmpl.length === 0 || f.title_tmpl.length > LIMITS.title) errors.push(`${w}: title_tmpl`);
    if (!isStr(f.observed_tmpl) || f.observed_tmpl.length === 0 || f.observed_tmpl.length > LIMITS.observed) errors.push(`${w}: observed_tmpl`);

    const coded = (list: unknown, codes: readonly string[], name: string, min: number, max: number) => {
      if (!Array.isArray(list) || list.length < min || list.length > max) { errors.push(`${w}: ${name}`); return [] as { code: string; text_tmpl: string }[]; }
      const out: { code: string; text_tmpl: string }[] = [];
      list.forEach((e, j) => {
        if (!isObj(e) || !isStr(e.code) || !codes.includes(e.code) || !isStr(e.text_tmpl) || e.text_tmpl.length > LIMITS.line) errors.push(`${w}: ${name}[${j}]`);
        else { noExtra(e, ["code", "text_tmpl"], `${w}.${name}[${j}]`, errors); out.push({ code: e.code, text_tmpl: e.text_tmpl }); }
      });
      return out;
    };
    const explanations = coded(f.explanations, EXPLANATION_CODES, "explanations", 1, 4);
    const actions = coded(f.actions, ACTION_CODES, "actions", 1, 3);

    const evidence: Evidence[] = [];
    if (!Array.isArray(f.evidence) || f.evidence.length < 1 || f.evidence.length > 8) errors.push(`${w}: evidence`);
    else f.evidence.forEach((e, j) => {
      if (!isObj(e) || !isStr(e.step) || !isStr(e.path) || !isStr(e.label)) errors.push(`${w}: evidence[${j}]`);
      else { noExtra(e, ["step", "path", "label"], `${w}.evidence[${j}]`, errors); evidence.push({ step: e.step, path: e.path, label: e.label.slice(0, 80) }); }
    });
    const gaps = Array.isArray(f.gaps) && f.gaps.length <= LIMITS.gaps && f.gaps.every(isStr) ? (f.gaps as string[]) : (errors.push(`${w}: gaps`), []);

    // Any error above makes the whole parse fail, so this value is only ever read when it is well formed.
    findings.push({
      candidate_id: String(f.candidate_id), kind: f.kind as AttendanceFamily, level: f.level as "site" | "person",
      severity: f.severity as Severity, subject: { type: (subject?.type as "site" | "person") ?? "site", alias: String(subject?.alias ?? "") },
      title_tmpl: String(f.title_tmpl ?? ""), observed_tmpl: String(f.observed_tmpl ?? ""),
      explanations: explanations as SubmittedFinding["explanations"], actions: actions as SubmittedFinding["actions"], evidence, gaps,
    });
  });

  if (!Array.isArray(raw.proposals)) errors.push("proposals must be an array");
  else if (raw.proposals.length > LIMITS.proposals) errors.push("too many proposals");
  else raw.proposals.forEach((p, i) => {
    const w = `proposals[${i}]`;
    if (!isObj(p)) return void errors.push(`${w}: not an object`);
    if (!Number.isInteger(p.finding_index) || (p.finding_index as number) < 0) errors.push(`${w}: finding_index`);
    if (!isStr(p.message_tmpl) || p.message_tmpl.length === 0 || p.message_tmpl.length > LIMITS.message) errors.push(`${w}: message_tmpl`);
    if (p.action === "wfm.recheck") {
      noExtra(p, ["action", "finding_index", "target_aliases", "message_tmpl"], w, errors);
      if (!Array.isArray(p.target_aliases) || p.target_aliases.length < 1 || p.target_aliases.length > LIMITS.recheckTargets || !p.target_aliases.every(isStr)) errors.push(`${w}: target_aliases`);
      else proposals.push({ action: "wfm.recheck", finding_index: p.finding_index as number, target_aliases: p.target_aliases as string[], message_tmpl: String(p.message_tmpl) });
    } else if (p.action === "site_note") {
      noExtra(p, ["action", "finding_index", "message_tmpl"], w, errors);
      proposals.push({ action: "site_note", finding_index: p.finding_index as number, message_tmpl: String(p.message_tmpl) });
    } else errors.push(`${w}: action '${String(p.action)}' is not allowed`);
  });

  const ntr = raw.nothing_to_report;
  if (ntr !== null && !isStr(ntr)) errors.push("nothing_to_report");
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { findings, proposals, nothing_to_report: (ntr as string | null) ?? null } };
}
