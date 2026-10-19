import { cfOnly, isUuid, sanitizeSearch } from "@/lib/estimator/requests";
import { MAX_MESSAGE_CHARS } from "./caps";
import {
  AREA_IDS, CHANGE_KINDS, PHASES, STUDY_STATUSES, TASK_OWNERS, WEEKENDS,
  type AreaId, type ChangeKind, type PhaseId, type StudyStatus, type TaskOwner, type Weekend,
} from "./types";

// Request-body parsers for the studio routes: pure, so they are tested, and
// strict about what they accept. A client-supplied tenant is never read from
// here (MULTI_TENANT_GUARDRAILS.md); foreign ids that do arrive (a step, a
// task, a change) are checked against the study by the route.

type Fail = { ok: false; error: string };
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const longText = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\r\n/g, "\n").trim().slice(0, max) : "");
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const MAX_NAME = 120;

export function parseCreate(body: unknown): { ok: true; name: string } | Fail {
  const name = text(isRecord(body) ? body.name : "", MAX_NAME);
  if (!name) return { ok: false, error: "Give the study a name." };
  return { ok: true, name };
}

export type ListParams = { q: string; status: StudyStatus | null; page: number; page_size: number };

export function parseListParams(sp: URLSearchParams): ListParams {
  const status = sp.get("status");
  const page = Number.parseInt(sp.get("page") ?? "1", 10);
  return {
    q: sanitizeSearch(sp.get("q") ?? ""),
    status: (STUDY_STATUSES as readonly string[]).includes(status ?? "") ? (status as StudyStatus) : null,
    page: Number.isFinite(page) && page > 0 ? page : 1,
    page_size: 20,
  };
}

export type StudyPatch = {
  patch: Record<string, unknown>;
  /** Contact email in plain text: the route encrypts it and never logs it. */
  contact_email?: string | null;
  custom_data?: Record<string, unknown>;
};

export function parseStudyPatch(body: unknown): ({ ok: true } & StudyPatch) | Fail {
  if (!isRecord(body)) return { ok: false, error: "Invalid body." };
  const patch: Record<string, unknown> = {};
  if ("name" in body) {
    const name = text(body.name, MAX_NAME);
    if (!name) return { ok: false, error: "The name can't be empty." };
    patch.name = name;
  }
  if ("follow_ups" in body) patch.follow_ups = body.follow_ups === true;
  if ("language" in body) {
    // English only in phase 1: the option exists, nothing else is accepted yet.
    if (body.language !== "en") return { ok: false, error: "Only English is available for now." };
    patch.language = "en";
  }
  if ("areas" in body) {
    if (!isRecord(body.areas)) return { ok: false, error: "Invalid areas." };
    const areas: Record<string, { off: boolean }> = {};
    for (const a of AREA_IDS) {
      const v = body.areas[a];
      if (isRecord(v) && v.off === true) areas[a] = { off: true };
    }
    patch.areas = areas;
  }
  if ("lanes" in body) {
    if (!Array.isArray(body.lanes)) return { ok: false, error: "Invalid lanes." };
    patch.lanes = [...new Set(body.lanes.map((l) => text(l, 60)).filter(Boolean))].slice(0, 20);
  }
  if ("plan_start_date" in body) {
    if (body.plan_start_date === null || body.plan_start_date === "") patch.plan_start_date = null;
    else if (typeof body.plan_start_date === "string" && ISO_DAY.test(body.plan_start_date) && !Number.isNaN(Date.parse(body.plan_start_date))) patch.plan_start_date = body.plan_start_date;
    else return { ok: false, error: "That start date is not valid." };
  }
  if ("weekend" in body) {
    if (!(WEEKENDS as readonly string[]).includes(String(body.weekend))) return { ok: false, error: "Unknown weekend." };
    patch.weekend = body.weekend as Weekend;
  }
  if ("contact_name" in body) patch.contact_name = text(body.contact_name, 120) || null;
  let contact_email: string | null | undefined;
  if ("contact_email" in body) {
    const e = text(body.contact_email, 200);
    if (e && !EMAIL.test(e)) return { ok: false, error: "That doesn't look like a valid email address." };
    contact_email = e || null;
  }
  const cf = "custom_data" in body ? cfOnly(body.custom_data) : undefined;
  return { ok: true, patch, contact_email, custom_data: cf };
}

export type ChatRequest = { text: string; area: AreaId | null };

export function parseChat(body: unknown): { ok: true; value: ChatRequest } | Fail {
  if (!isRecord(body)) return { ok: false, error: "Invalid body." };
  const t = longText(body.text, MAX_MESSAGE_CHARS);
  if (!t) return { ok: false, error: "Write a message first." };
  const area = (AREA_IDS as readonly string[]).includes(String(body.area)) ? (body.area as AreaId) : null;
  return { ok: true, value: { text: t, area } };
}

export type StepInput = {
  area: AreaId; lane: string; name: string; what: string | null; how_today: string | null; frequency: string | null; hands_over: boolean;
};

export function parseStepCreate(body: unknown): { ok: true; value: StepInput } | Fail {
  if (!isRecord(body)) return { ok: false, error: "Invalid body." };
  const name = text(body.name, 120);
  if (!name) return { ok: false, error: "Name the step." };
  if (!(AREA_IDS as readonly string[]).includes(String(body.area))) return { ok: false, error: "Choose an area." };
  return {
    ok: true,
    value: {
      area: body.area as AreaId, lane: text(body.lane, 60) || "Team", name,
      what: text(body.what, 300) || null, how_today: text(body.how_today, 200) || null,
      frequency: text(body.frequency, 80) || null, hands_over: body.hands_over === true,
    },
  };
}

export function parseStepPatch(body: unknown): { ok: true; patch: Record<string, unknown> } | Fail {
  if (!isRecord(body)) return { ok: false, error: "Invalid body." };
  const patch: Record<string, unknown> = {};
  if ("name" in body) {
    const n = text(body.name, 120);
    if (!n) return { ok: false, error: "A step needs a name." };
    patch.name = n;
  }
  if ("lane" in body) patch.lane = text(body.lane, 60) || "Team";
  if ("what" in body) patch.what = text(body.what, 300) || null;
  if ("how_today" in body) patch.how_today = text(body.how_today, 200) || null;
  if ("frequency" in body) patch.frequency = text(body.frequency, 80) || null;
  if ("hands_over" in body) patch.hands_over = body.hands_over === true;
  if ("assumed" in body) patch.assumed = body.assumed === true;
  if ("area" in body) {
    if (!(AREA_IDS as readonly string[]).includes(String(body.area))) return { ok: false, error: "Unknown area." };
    patch.area = body.area;
  }
  if ("sort_order" in body) {
    const n = Math.round(Number(body.sort_order));
    if (!Number.isFinite(n) || n < 0 || n > 100000) return { ok: false, error: "Invalid order." };
    patch.sort_order = n;
  }
  return Object.keys(patch).length ? { ok: true, patch } : { ok: false, error: "Nothing to change." };
}

export type ChangeInput = { kind: ChangeKind; title: string; plain: string };

export function parseChangeCreate(body: unknown): { ok: true; value: ChangeInput } | Fail {
  if (!isRecord(body)) return { ok: false, error: "Invalid body." };
  const title = text(body.title, 120);
  if (!title) return { ok: false, error: "Give the change a title." };
  const kind = (CHANGE_KINDS as readonly string[]).includes(String(body.kind)) ? (body.kind as ChangeKind) : "setting";
  return { ok: true, value: { kind, title, plain: text(body.plain, 400) } };
}

export function parseChangePatch(body: unknown): { ok: true; patch: Record<string, unknown> } | Fail {
  if (!isRecord(body)) return { ok: false, error: "Invalid body." };
  const patch: Record<string, unknown> = {};
  if ("kept" in body) patch.kept = body.kept === true;
  if ("title" in body) {
    const t = text(body.title, 120);
    if (!t) return { ok: false, error: "A change needs a title." };
    patch.title = t;
  }
  if ("plain" in body) patch.plain = text(body.plain, 400);
  return Object.keys(patch).length ? { ok: true, patch } : { ok: false, error: "Nothing to change." };
}

export type PlanSave = {
  start_date?: string | null;
  weekend?: Weekend;
  durations: { task_id: string; duration_days: number }[];
  owners: { task_id: string; owner: TaskOwner }[];
  oks: { phase: PhaseId; ok: boolean }[];
  comments: { phase: PhaseId; task_id: string | null; text: string }[];
  added: { phase: PhaseId; name: string; owner: TaskOwner; duration_days: number }[];
  removed: string[];
};

export function parsePlanSave(body: unknown): { ok: true; value: PlanSave } | Fail {
  if (!isRecord(body)) return { ok: false, error: "Invalid body." };
  const out: PlanSave = { durations: [], owners: [], oks: [], comments: [], added: [], removed: [] };
  if ("start_date" in body) {
    if (body.start_date === null || body.start_date === "") out.start_date = null;
    else if (typeof body.start_date === "string" && ISO_DAY.test(body.start_date) && !Number.isNaN(Date.parse(body.start_date))) out.start_date = body.start_date;
    else return { ok: false, error: "That start date is not valid." };
  }
  if ("weekend" in body) {
    if (!(WEEKENDS as readonly string[]).includes(String(body.weekend))) return { ok: false, error: "Unknown weekend." };
    out.weekend = body.weekend as Weekend;
  }
  const arr = (k: string): unknown[] => (Array.isArray(body[k]) ? (body[k] as unknown[]).slice(0, 300) : []);
  const phaseOk = (p: unknown): p is PhaseId => (PHASES as readonly string[]).includes(String(p));
  for (const d of arr("durations")) {
    if (!isRecord(d) || !isUuid(d.task_id)) return { ok: false, error: "Invalid task." };
    const n = Math.round(Number(d.duration_days));
    if (!Number.isFinite(n) || n < 1 || n > 60) return { ok: false, error: "A task takes between 1 and 60 working days." };
    out.durations.push({ task_id: d.task_id, duration_days: n });
  }
  for (const o of arr("owners")) {
    if (!isRecord(o) || !isUuid(o.task_id) || !(TASK_OWNERS as readonly string[]).includes(String(o.owner))) return { ok: false, error: "Invalid owner." };
    out.owners.push({ task_id: o.task_id, owner: o.owner as TaskOwner });
  }
  for (const k of arr("oks")) {
    if (!isRecord(k) || !phaseOk(k.phase)) return { ok: false, error: "Invalid phase." };
    out.oks.push({ phase: k.phase, ok: k.ok === true });
  }
  for (const c of arr("comments")) {
    if (!isRecord(c) || !phaseOk(c.phase)) return { ok: false, error: "Invalid comment." };
    if (c.task_id !== null && c.task_id !== undefined && !isUuid(c.task_id)) return { ok: false, error: "Invalid comment." };
    out.comments.push({ phase: c.phase, task_id: (c.task_id as string | null | undefined) ?? null, text: longText(c.text, 2000) });
  }
  for (const a of arr("added")) {
    if (!isRecord(a) || !phaseOk(a.phase)) return { ok: false, error: "Invalid task." };
    const name = text(a.name, 120);
    if (!name) return { ok: false, error: "Name the task." };
    const n = Math.round(Number(a.duration_days));
    out.added.push({
      phase: a.phase, name, owner: a.owner === "bpmsquare" ? "bpmsquare" : "client",
      duration_days: Number.isFinite(n) ? Math.min(60, Math.max(1, n)) : 1,
    });
  }
  for (const r of arr("removed")) {
    if (!isUuid(r)) return { ok: false, error: "Invalid task." };
    out.removed.push(r);
  }
  return { ok: true, value: out };
}

export function parseSend(body: unknown): { ok: true; name: string; email: string } | Fail {
  if (!isRecord(body)) return { ok: false, error: "Invalid body." };
  const name = text(body.name, 120);
  const email = text(body.email, 200);
  if (!name) return { ok: false, error: "Tell us who to ask for." };
  if (!EMAIL.test(email)) return { ok: false, error: "That doesn't look like a valid email address." };
  return { ok: true, name, email };
}

export const REVIEW_RATINGS = ["standard", "needs_setup", "partly", "not_covered", "needs_review", "coming"] as const;
export const REQUEST_STATUSES = ["new", "contacted", "accepted", "rescoped", "declined"] as const;

export { isUuid };
