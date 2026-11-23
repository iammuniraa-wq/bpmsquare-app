import type { DrawingRow, DrawingTypeRow, RequiredFieldKey, RevisionRow, RevisionStatus, RevScheme } from "./types";
import { REQUIRED_FIELD_KEYS, REQUIRED_FIELD_LABEL } from "./types";

// The rules of the Drawing register, as pure functions so the routes, the screens and the tests all read one source
// (docs/design/pcbs-drawing-register.md sections 1 and 2).

// ── Revision labels ────────────────────────────────────────────────────────────────────────────────────────────────

/** 0 -> A, 1 -> B ... 25 -> Z, 26 -> AA, 27 -> AB ... (spreadsheet columns, so a label never repeats). */
export function lettersLabel(n: number): string {
  let i = Math.max(0, Math.floor(n)) + 1;
  let out = "";
  while (i > 0) { const r = (i - 1) % 26; out = String.fromCharCode(65 + r) + out; i = Math.floor((i - 1) / 26); }
  return out;
}

/** The label a revision with this number gets under the type's scheme. rev_no is 0 for the first issue. */
export function revLabelFor(scheme: RevScheme, revNo: number): string {
  return scheme === "numbers" ? String(Math.max(0, Math.floor(revNo))) : lettersLabel(revNo);
}

export function nextRevNo(existing: readonly { rev_no: number }[]): number {
  return existing.reduce((m, r) => Math.max(m, r.rev_no + 1), 0);
}

/** A hand-typed label: short, no spaces or slashes (it is printed on drawings and sent to the ERP). */
export function revLabelProblem(label: string): string | null {
  const l = label.trim();
  if (!l) return "A revision label is needed";
  if (l.length > 12) return "A revision label is at most 12 characters";
  if (!/^[A-Za-z0-9._-]+$/.test(l)) return "A revision label uses letters, numbers, dots and dashes only";
  return null;
}

// ── Drawing numbers ────────────────────────────────────────────────────────────────────────────────────────────────

export function normaliseDrawingNo(no: string): string { return no.trim().replace(/\s+/g, " "); }

export function drawingNoProblem(no: string): string | null {
  const n = normaliseDrawingNo(no);
  if (!n) return "A drawing number is needed";
  if (n.length > 80) return "A drawing number is at most 80 characters";
  if (/[\\/<>"'`]/.test(n)) return "A drawing number cannot contain slashes, quotes or angle brackets";
  return null;
}

/**
 * A type's numbering pattern, for example "{project}-{discipline}-{seq3}". `{seq3}` is exactly three digits, `{seq}` any run of digits,
 * any other `{word}` is one run of letters and digits. Everything else is literal. An empty pattern accepts any number.
 */
export function patternToRegExp(pattern: string): RegExp {
  let src = "";
  let i = 0;
  while (i < pattern.length) {
    const m = /^\{([A-Za-z][A-Za-z0-9_]*)\}/.exec(pattern.slice(i));
    if (m) {
      const word = m[1];
      const seq = /^seq(\d*)$/i.exec(word);
      if (seq) src += seq[1] ? `\\d{${Number(seq[1])}}` : "\\d+";
      else src += "[A-Za-z0-9]+";
      i += m[0].length;
    } else {
      src += pattern[i].replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&");
      i += 1;
    }
  }
  return new RegExp(`^${src}$`, "i");
}

export function numberingProblem(pattern: string | null | undefined, no: string): string | null {
  if (!pattern || !pattern.trim()) return null;
  return patternToRegExp(pattern.trim()).test(normaliseDrawingNo(no)) ? null : `The number does not follow this type's pattern ${pattern.trim()}`;
}

// ── Status flow ────────────────────────────────────────────────────────────────────────────────────────────────────

const EDGES: Record<RevisionStatus, readonly RevisionStatus[]> = {
  draft: ["in_review"],
  in_review: ["released", "draft"],
  released: ["superseded"],
  superseded: [],
};
export const canTransition = (from: RevisionStatus, to: RevisionStatus): boolean => EDGES[from].includes(to);

/** A revision's header and file may change only while it is a draft; elements likewise. */
export const isEditable = (r: Pick<RevisionRow, "status">): boolean => r.status === "draft";
/** A draft with no history can be deleted; a revision that left draft never is. */
export const isDeletable = (r: Pick<RevisionRow, "status" | "submitted_at">): boolean => r.status === "draft" && !r.submitted_at;

// ── Submit ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** What is still missing before a draft can be submitted for review (docs section 2). Empty = ready. */
export function submitProblems(args: { drawing: Pick<DrawingRow, "drawing_no" | "external_no" | "opportunity_id" | "project_id" | "wbs_item_id">; revision: Pick<RevisionRow, "rev_label" | "file_path" | "notes" | "change_summary">; type: Pick<DrawingTypeRow, "required_fields" | "numbering_pattern"> | null; hasElements?: boolean }): string[] {
  const out: string[] = [];
  const { drawing, revision, type } = args;
  const no = drawingNoProblem(drawing.drawing_no);
  if (no) out.push(no);
  else if (type) { const p = numberingProblem(type.numbering_pattern, drawing.drawing_no); if (p) out.push(p); }
  const lab = revLabelProblem(revision.rev_label);
  if (lab) out.push(lab);
  const hasModelRef = !!revision.change_summary?.elements || args.hasElements === true;
  if (!revision.file_path && !hasModelRef) out.push("Attach the drawing file (or load its element schedule)");
  for (const key of type?.required_fields ?? []) {
    if (!(REQUIRED_FIELD_KEYS as readonly string[]).includes(key)) continue;
    const k = key as RequiredFieldKey;
    const v = k === "notes" ? revision.notes : (drawing as unknown as Record<string, unknown>)[k];
    if (v == null || (typeof v === "string" && !v.trim())) out.push(`${REQUIRED_FIELD_LABEL[k]} is required for this type`);
  }
  return out;
}

// ── Who may release ────────────────────────────────────────────────────────────────────────────────────────────────

export type ReleaseCheck = { ok: true } | { ok: false; status: 403 | 409; error: string };

/**
 * Authority is checked on the server and is NOT a Business Role (owner 2026-10-23: roles are menu visibility, not a boundary).
 * The caller must be one of the type's named approvers, or a workspace admin when the type names none; and, when the type asks for a
 * second person, must not be the person who submitted. A connector can never release: it has no user id, so `userId` is required.
 */
export function releaseDecision(args: { type: Pick<DrawingTypeRow, "approver_ids" | "second_person"> | null; revision: Pick<RevisionRow, "status" | "submitted_by">; userId: string; role: "admin" | "member" }): ReleaseCheck {
  const { type, revision, userId, role } = args;
  if (revision.status !== "in_review") return { ok: false, status: 409, error: "Only a revision in review can be released" };
  const approvers = type?.approver_ids ?? [];
  const allowed = approvers.length > 0 ? approvers.includes(userId) : role === "admin";
  if (!allowed) return { ok: false, status: 403, error: approvers.length > 0 ? "You are not a named approver for this type of drawing" : "Only a workspace admin can release this type of drawing" };
  const second = type ? type.second_person : true;
  if (second && revision.submitted_by && revision.submitted_by === userId) return { ok: false, status: 403, error: "The person who submitted a revision cannot release it. Ask another approver" };
  return { ok: true };
}

/** Who may send a revision in review back to draft: the person who submitted it (withdrawing), a named approver, or a workspace admin. */
export function mayReturn(args: { type: Pick<DrawingTypeRow, "approver_ids"> | null; revision: Pick<RevisionRow, "status" | "submitted_by">; userId: string; role: "admin" | "member" }): boolean {
  if (args.revision.status !== "in_review") return false;
  return args.role === "admin" || args.revision.submitted_by === args.userId || (args.type?.approver_ids ?? []).includes(args.userId);
}

/** Can this person release if it were in review? Drives whether the button shows (the route still decides). */
export function mayRelease(args: { type: Pick<DrawingTypeRow, "approver_ids" | "second_person"> | null; submittedBy: string | null; userId: string; role: "admin" | "member" }): boolean {
  return releaseDecision({ type: args.type, revision: { status: "in_review", submitted_by: args.submittedBy }, userId: args.userId, role: args.role }).ok;
}

// ── Display ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** What a drawing is "at": the released revision's label when there is one, else its newest. */
export function headlineRevision<T extends Pick<RevisionRow, "id" | "status" | "rev_no">>(revisions: readonly T[], currentRevId: string | null): T | null {
  if (!revisions.length) return null;
  const released = revisions.find((r) => r.id === currentRevId) ?? revisions.find((r) => r.status === "released");
  if (released) return released;
  return [...revisions].sort((a, b) => b.rev_no - a.rev_no)[0];
}
